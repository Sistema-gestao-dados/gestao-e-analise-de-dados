import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaginado } from "@/lib/fetch-paginado";

export type SiglaEstacao = {
  sigla: string;
  descricao: string;
  local: "Garagem" | "Ponto";
};

// `siglas_estacao` é uma tabela nova — só aparece nos tipos gerados do
// Supabase (src/integrations/supabase/types.ts) depois que a migração for
// aplicada e os tipos forem regenerados. Até lá, cast local (mesmo padrão já
// usado em src/lib/calendario.ts pra tabela ainda não refletida no gen).
const db = () => supabase as any;

export async function fetchSiglasEstacao(): Promise<SiglaEstacao[]> {
  return fetchAllPaginado<SiglaEstacao>("siglas_estacao", "*", { order: { column: "sigla" }, tiebreak: "sigla" });
}

/** Resolve sigla -> {descricao, local}, normalizando (trim + maiúsculas) —
 *  viagens.origem/destino vêm crus do feed, podem ter espaço nas pontas. */
export function buildSiglaMap(siglas: SiglaEstacao[]): Map<string, SiglaEstacao> {
  return new Map(siglas.map((s) => [s.sigla.trim().toUpperCase(), s]));
}

export function resolveSigla(map: Map<string, SiglaEstacao>, valor: string | null | undefined): SiglaEstacao | null {
  if (!valor) return null;
  return map.get(valor.trim().toUpperCase()) ?? null;
}

export async function upsertSiglaEstacao(row: SiglaEstacao): Promise<void> {
  const { error } = await db().from("siglas_estacao").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "sigla" });
  if (error) throw error;
}

export async function deleteSiglaEstacao(sigla: string): Promise<void> {
  const { error } = await db().from("siglas_estacao").delete().eq("sigla", sigla);
  if (error) throw error;
}
