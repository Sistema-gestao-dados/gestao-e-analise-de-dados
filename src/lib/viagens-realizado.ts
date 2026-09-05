import { supabase } from "@/integrations/supabase/client";
import type { RealizadoRow } from "@/lib/realizado";

export type RealizadoDb = RealizadoRow & { id: string; arquivo: string | null; created_at: string };

/** Busca todo o período informado (inclusive), paginando de 1000 em 1000. */
export async function fetchRealizado(dataInicio: string, dataFim: string): Promise<RealizadoDb[]> {
  const all: RealizadoDb[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await (supabase as any)
      .from("viagens_realizado")
      .select("*")
      .gte("data", dataInicio)
      .lte("data", dataFim)
      .range(from, from + 999);
    if (error) throw error;
    const chunk = (data ?? []) as RealizadoDb[];
    all.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return all;
}

/** Datas distintas já importadas (pra popular o seletor de período). */
export async function fetchRealizadoDatasDisponiveis(): Promise<string[]> {
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
