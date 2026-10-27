import { supabase } from "@/integrations/supabase/client";
import type { ParametroMulti } from "@/lib/data";
import { fetchAllPaginado } from "@/lib/fetch-paginado";

export type Historico = {
  id: string;
  linha: string;
  versao: number | null;
  dia_tipo: string | null;
  referencia: string | null;
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
  return fetchAllPaginado<Historico>("historico_reprogramacao", "*", { order: { column: "vigencia", ascending: false } });
}

export async function fetchHistoricoDiaTipos(): Promise<string[]> {
  const rows = await fetchAllPaginado<{ nome: string }>("historico_dia_tipos", "nome", { order: { column: "nome" } });
  return rows.map((r) => r.nome);
}

export async function ensureDiaTipo(nome: string): Promise<void> {
  const v = nome.trim();
  if (!v) return;
  const { error } = await supabase.from("historico_dia_tipos").upsert({ nome: v }, { onConflict: "nome", ignoreDuplicates: true });
  if (error) throw error;
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

/** Número da versão a partir do texto "Projeto / Versão" das viagens
 *  (o Histórico só guarda o número). Formatos vistos nos arquivos:
 *  "532M S Versao 42" -> 42, "15 U V210 2 QUINZ" -> 210, "VER 213",
 *  "0101AUV228 2QUINZ" -> 228, "U213 2QZ" -> 213, "MB22 757MU 120826V32"
 *  -> 32, "U 100D 423M SEX 296" -> 296. Ordem: número depois de
 *  VERSAO/VER/V; senão letra do dia colada (U/S/D + número); senão o último
 *  número solto. Quinzena ("2 QUINZ"/"2QZ") e datas de 8 dígitos não
 *  contam. null = não achou número. */
export function numeroVersao(texto: string | null | undefined): number | null {
  let s = (texto ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/\b\d\s*(QUINZ\w*|QZ)\b/g, " ").replace(/\d{8}/g, " ");
  const comV = [...s.matchAll(/(?:VERSAO|VER|V)\s*\.?\s*(\d+)(?![A-Z0-9])/g)];
  if (comV.length) return Number(comV[comV.length - 1][1]);
  const colado = [...s.matchAll(/(?<![A-Z0-9])[USD](\d+)(?![A-Z0-9])/g)];
  if (colado.length) return Number(colado[colado.length - 1][1]);
  const soltos = [...s.matchAll(/(?<![A-Z0-9])(\d+)(?![A-Z0-9])/g)];
  return soltos.length ? Number(soltos[soltos.length - 1][1]) : null;
}

export type DiaTipoBase = "Dias úteis" | "Sábado" | "Domingo";

/** Dia tipo "base" de um texto livre — o Histórico tem vocabulário próprio
 *  (DU, Útil, SAB...), diferente de `viagens.tipo_operacao`. null = não
 *  reconheceu (ex.: "Feriado X" sem dia pai conhecido). */
export function diaTipoBase(texto: string | null | undefined): DiaTipoBase | null {
  const s = (texto ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!s) return null;
  // "SEG A SEX", "SEX" etc. são dia útil — não confundir "S"/"SEX" com Sábado.
  if (/^(du|u)$/.test(s) || /^(seg|ter|qua|qui|sex)/.test(s) || /\buteis?\b|\butil\b/.test(s)) return "Dias úteis";
  if (/^(s|sab)$/.test(s) || /^sab/.test(s)) return "Sábado";
  if (/^(d|dom)$/.test(s) || /^dom/.test(s)) return "Domingo";
  return null;
}
