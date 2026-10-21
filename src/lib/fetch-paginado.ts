import { supabase } from "@/integrations/supabase/client";

// Busca TODAS as linhas de uma tabela/view em páginas de 1000.
//
// ATENÇÃO — histórico: a versão anterior buscava todas as páginas em
// PARALELO usando `.range(offset, offset+999)` (OFFSET/LIMIT). Isso
// parecia ótimo (~1x o round-trip em vez de ~21x), mas tem um problema
// sério que só aparece em tabelas grandes: o custo de um OFFSET cresce
// com o próprio offset (pra pular 45 mil linhas, o Postgres ainda precisa
// varrer e descartar essas 45 mil antes de montar a página). Com ~55
// páginas desse tipo disparadas AO MESMO TEMPO numa tabela de 55 mil
// linhas (`viagens`), isso sobrecarregou o banco a ponto de várias
// páginas devolverem erro 500 depois de 8-30s cada — incidente real em
// produção em 13/out/2026, mesmo com a política RLS já OTIMIZADA (sem
// função nenhuma por linha). Ou seja: nem uma política barata salva um
// padrão de busca que escala mal.
//
// Esta versão usa busca por CURSOR (keyset/"seek method"): cada página
// pede "me dá os próximos 1000 depois de onde eu parei" (`WHERE col >
// cursor ORDER BY col LIMIT 1000`), que custa sempre o mesmo (O(tamanho
// da página)), não importa a profundidade. Paga o preço de voltar a ser
// sequencial (uma página espera a anterior) — mais lento que o paralelo
// ideal, mas não quebra em tabela grande. Se a velocidade virar problema
// de novo, a forma certa de acelerar é buscar só os CURSORES (coluna de
// ordenação) numa consulta leve pra descobrir os limites de cada página
// de antemão e aí sim paralelizar os `.gt()` — não é voltar pro
// range/offset puro.
//
// `order` por padrão é por `id` (a maioria das tabelas do projeto tem
// uuid `id` como PK); quando o chamador passa outra coluna (ex.:
// "vigencia", "data_inicio", "ordem" — nenhuma delas única), sempre
// encadeia um desempate único (`tiebreak`), senão duas linhas empatadas
// no valor de ordenação podem repetir ou sumir entre páginas. `tiebreak`
// é configurável porque `linhas` não tem coluna `id` (a PK dela é a
// própria coluna `linha`).
export async function fetchAllPaginado<T>(
  table: string,
  select: string,
  opts?: {
    pageSize?: number;
    order?: { column: string; ascending?: boolean };
    tiebreak?: string;
    /** Filtro aplicado em TODA página (ex.: período: q => q.gte(...).lte(...)). */
    filtro?: (q: any) => any;
  },
): Promise<T[]> {
  const client = supabase as any;
  // 6000 bate com o "Max Rows" configurado no Supabase (Data API Settings) —
  // subir esse número aqui sem subir lá não adianta nada (o servidor corta
  // sozinho); subir lá sem subir aqui também não ajuda (ainda pede 1000 por
  // vez). Os dois precisam andar juntos.
  const pageSize = opts?.pageSize ?? 6000;
  const orderColumn = opts?.order?.column ?? "id";
  const ascending = opts?.order?.ascending ?? true;
  const tiebreak = opts?.tiebreak ?? "id";
  const compound = orderColumn !== tiebreak;
  const cmpOrder = ascending ? "gt" : "lt";

  const applyOrder = (q: any) => {
    q = q.order(orderColumn, { ascending });
    if (compound) q = q.order(tiebreak, { ascending: true });
    return q;
  };

  // O cursor precisa ler de volta o valor da(s) coluna(s) de ordenação da
  // última linha de cada página — mas o `select` do chamador pode não
  // incluir essas colunas (ex.: fetchHistoricoDiaTipos pede só "nome",
  // mas o desempate é por "id"). Busca essas colunas A MAIS quando
  // necessário, e remove de novo antes de devolver, pra não vazar campo
  // que o chamador não pediu (e não tipou).
  const requested = select === "*" ? null : new Set(select.split(",").map((s) => s.trim()));
  const extra = [orderColumn, ...(compound ? [tiebreak] : [])].filter((c) => requested && !requested.has(c));
  const fetchSelect = extra.length ? [select, ...extra].join(",") : select;

  // `.or()` recebe a condição como string crua do PostgREST — precisa
  // escapar o valor do cursor manualmente (diferente de `.gt()`/`.lt()`,
  // que fazem isso sozinhos), senão um valor com vírgula/parênteses
  // (ex.: nome de dia tipo digitado à mão) quebra o parser do filtro.
  const quote = (v: any) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  const all: T[] = [];
  let cursorOrder: any = null;
  let cursorTiebreak: any = null;

  for (;;) {
    let q = client.from(table).select(fetchSelect);
    if (opts?.filtro) q = opts.filtro(q);
    q = applyOrder(q).limit(pageSize);
    if (cursorOrder !== null) {
      q = compound
        ? q.or(
            `${orderColumn}.${cmpOrder}.${quote(cursorOrder)},and(${orderColumn}.eq.${quote(cursorOrder)},${tiebreak}.gt.${quote(cursorTiebreak)})`,
          )
        : q[cmpOrder](orderColumn, cursorOrder);
    }
    const { data, error } = await q;
    if (error) throw error;
    const chunk = (data ?? []) as any[];
    if (chunk.length) {
      const last = chunk[chunk.length - 1];
      cursorOrder = last[orderColumn];
      cursorTiebreak = compound ? last[tiebreak] : undefined;
    }
    for (const row of chunk) {
      if (extra.length) for (const c of extra) delete row[c];
      all.push(row as T);
    }
    if (chunk.length < pageSize) break;
  }

  return all;
}
