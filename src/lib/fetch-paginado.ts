import { supabase } from "@/integrations/supabase/client";

// Busca TODAS as linhas de uma tabela/view em páginas de 1000, em PARALELO
// em vez de sequencial. O padrão antigo (repetido em vários lugares do
// app) fazia `for (;;) { ...await página...; from += 1000 }` — pra uma
// tabela com 20 mil+ linhas (ex.: viagens), isso é ~21 idas-e-voltas ao
// servidor, uma esperando a anterior terminar. Aqui a gente descobre o
// total de linhas primeiro (1 requisição HEAD, sem corpo) e dispara todas
// as páginas de uma vez com Promise.all — o tempo de carregamento cai de
// "21x o round-trip" pra "~1x o round-trip" (todas voltam juntas).
//
// Não muda NENHUM dado retornado nem lógica de filtro — só a forma de
// buscar. `order` por padrão é por `id` (a maioria das tabelas do projeto
// tem uuid `id` como PK); quando o chamador passa outra coluna (ex.:
// "vigencia", "data_inicio", "ordem" — nenhuma delas única), sempre
// encadeia um desempate único, senão duas páginas buscadas em paralelo não
// têm garantia de ordem relativa entre linhas empatadas e podem
// repetir/pular alguma. O desempate é `id` por padrão, MAS a tabela
// `linhas` não tem coluna `id` (a PK dela é a própria coluna `linha`) — por
// isso `tiebreak` é configurável, não fixo em "id" (fixo quebrava toda
// consulta na tabela `linhas` com "column linhas.id does not exist",
// fazendo o Cadastro de Linhas inteiro sumir da tela por erro, não por
// dado apagado).
export async function fetchAllPaginado<T>(
  table: string,
  select: string,
  opts?: { pageSize?: number; order?: { column: string; ascending?: boolean }; tiebreak?: string },
): Promise<T[]> {
  const client = supabase as any;
  const pageSize = opts?.pageSize ?? 1000;
  const orderColumn = opts?.order?.column ?? "id";
  const ascending = opts?.order?.ascending ?? true;
  const tiebreak = opts?.tiebreak ?? "id";

  const applyOrder = (q: any) => {
    q = q.order(orderColumn, { ascending });
    if (orderColumn !== tiebreak) q = q.order(tiebreak, { ascending: true });
    return q;
  };

  const { count, error: countError } = await client.from(table).select("*", { count: "exact", head: true });
  if (countError) throw countError;
  const total = count ?? 0;
  if (total === 0) return [];

  const pages = Math.ceil(total / pageSize);
  const requests = Array.from({ length: pages }, (_, i) =>
    applyOrder(client.from(table).select(select)).range(i * pageSize, i * pageSize + pageSize - 1),
  );
  const results = await Promise.all(requests);

  const all: T[] = [];
  for (const r of results) {
    if (r.error) throw r.error;
    all.push(...((r.data ?? []) as T[]));
  }

  // Proteção contra corrida com escrita concorrente (ex.: alguém importando
  // um TXT enquanto essa busca roda): se o total cresceu entre a contagem
  // inicial e agora, busca sequencialmente só o que ficou de fora, em vez
  // de simplesmente devolver um resultado incompleto sem avisar.
  const { count: countDepois } = await client.from(table).select("*", { count: "exact", head: true });
  if ((countDepois ?? 0) > total) {
    let from = pages * pageSize;
    for (;;) {
      const { data, error } = await applyOrder(client.from(table).select(select)).range(from, from + pageSize - 1);
      if (error) throw error;
      const chunk = (data ?? []) as T[];
      all.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
  }

  return all;
}
