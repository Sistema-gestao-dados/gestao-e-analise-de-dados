import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaginado } from "@/lib/fetch-paginado";
import type { RealizadoRow } from "@/lib/realizado";

export type RealizadoDb = RealizadoRow & { id: string; arquivo: string | null; created_at: string };

/** Busca todo o período informado (inclusive) — paginação por cursor
 *  (fetchAllPaginado), não por OFFSET: período longo (30 dias ≈ 90 mil
 *  linhas) ficava cada vez mais lento a cada página com OFFSET. */
export async function fetchRealizado(dataInicio: string, dataFim: string): Promise<RealizadoDb[]> {
  return fetchAllPaginado<RealizadoDb>("viagens_realizado", "*", {
    filtro: (q) => q.gte("data", dataInicio).lte("data", dataFim),
  });
}

/** Datas distintas já importadas (pra popular o seletor de período).
 *  Calculadas no banco (RPC viagens_realizado_datas) — buscar a coluna
 *  `data` linha a linha parava em 5000 registros (~1-2 dias de operação)
 *  e o aviso "X dia(s) importado(s), de A a B" mostrava só os mais
 *  recentes. Se a função ainda não existir no banco, cai na busca antiga. */
export async function fetchRealizadoDatasDisponiveis(): Promise<string[]> {
  const rpc = await (supabase as any).rpc("viagens_realizado_datas");
  if (!rpc.error) return ((rpc.data ?? []) as string[]).slice().sort().reverse();
  const { data, error } = await (supabase as any)
    .from("viagens_realizado")
    .select("data")
    .order("data", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r: { data: string }) => r.data))).sort().reverse() as string[];
}

export async function insertRealizado(
  rows: (RealizadoRow & { arquivo: string })[],
): Promise<{ inserted: number; duplicadas: number; errors: string[] }> {
  let inserted = 0;
  let duplicadas = 0;
  const errors: string[] = [];
  const chunkSize = 500;
  // dedupe_key é calculada aqui (não pelo banco) — mesma chave natural de
  // antes: data + empresa + linha + número + sentido.
  const payload = rows.map((r) => ({
    ...r,
    dedupe_key: `${r.data}|${r.empresa ?? ""}|${r.linha}|${r.numero ?? ""}|${r.sentido ?? ""}`,
  }));
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { data, error } = await (supabase as any)
      .from("viagens_realizado")
      .upsert(chunk, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) errors.push(error.message);
    else {
      const n = (data ?? []).length;
      inserted += n;
      duplicadas += chunk.length - n;
    }
  }
  return { inserted, duplicadas, errors };
}
