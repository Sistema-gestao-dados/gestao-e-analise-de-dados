import { supabase } from "@/integrations/supabase/client";
import type { ParametroMulti } from "@/lib/data";

export type Historico = {
  id: string;
  linha: string;
  versao: number | null;
  dia_tipo: string | null;
  data_solicitacao: string | null;
  vigencia: string | null;
  encerramento: string | null;
  alteracao: string | null;
  ativo: boolean | null;
  created_at: string;
  updated_at: string;
};

export type HistoricoInput = Omit<Historico, "id" | "created_at" | "updated_at">;

export async function fetchHistorico(): Promise<Historico[]> {
  const all: Historico[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("historico_reprogramacao")
      .select("*")
      .order("vigencia", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    const chunk = (data ?? []) as Historico[];
    all.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return all;
}

export async function fetchHistoricoDiaTipos(): Promise<string[]> {
  const { data, error } = await supabase.from("historico_dia_tipos").select("nome").order("nome");
  if (error) throw error;
  return (data ?? []).map((r) => r.nome);
}

export async function ensureDiaTipo(nome: string): Promise<void> {
  const v = nome.trim();
  if (!v) return;
  await supabase.from("historico_dia_tipos").upsert({ nome: v }, { onConflict: "nome", ignoreDuplicates: true });
}

export async function insertHistorico(row: HistoricoInput): Promise<Historico> {
  const { data, error } = await supabase.from("historico_reprogramacao").insert(row).select("*").single();
  if (error) throw error;
  return data as Historico;
}

export async function updateHistorico(id: string, row: Partial<HistoricoInput>): Promise<void> {
  const { error } = await supabase.from("historico_reprogramacao").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteHistorico(id: string): Promise<void> {
  const { error } = await supabase.from("historico_reprogramacao").delete().eq("id", id);
  if (error) throw error;
}

/** Exclusão em lote — 1 requisição por lote de ~200 ids, em vez de 1 por
 * registro. Um DELETE ... WHERE id IN (...) com os 2000+ ids de uma vez só
 * estoura o limite prático de tamanho de URL do Supabase, por isso divide
 * em lotes pequenos (ainda assim, poucas dezenas de requisições no total,
 * não milhares). */
export async function deleteHistoricoBulk(ids: string[]): Promise<{ ok: number; falhas: number }> {
  const CHUNK = 200;
  let ok = 0, falhas = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error, count } = await supabase.from("historico_reprogramacao").delete({ count: "exact" }).in("id", chunk);
    if (error) falhas += chunk.length;
    else ok += count ?? chunk.length;
  }
  return { ok, falhas };
}

/** Linhas de um Grupo de Linha (mesmo cadastro usado nos relatórios de
 * Resumo/Comparativo/Dashboard) — reaproveita `parametro_multilinha`
 * (grupo_du), ignorando a distinção por tipo de dia (aqui é "pertence ao
 * grupo em qualquer dia tipo"). */
export function buildGrupoParaLinhas(multi: ParametroMulti[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const row of multi) {
    if (!row.grupo_du) continue;
    const set = m.get(row.grupo_du) ?? new Set<string>();
    set.add(row.linha);
    m.set(row.grupo_du, set);
  }
  return m;
}
