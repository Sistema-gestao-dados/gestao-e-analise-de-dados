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

/** Chave de comparação de código de linha: sem zero à esquerda no número
 *  do início ("01" = "1", "08A" = "8A") e sem diferença de maiúscula. Só
 *  pra COMPARAR — o código gravado/exibido segue o Cadastro de Linhas
 *  (ver linhaDoCadastro). O CSV aberto no Excel perde o zero ("01" -> 1). */
export function chaveLinha(linha: string | null | undefined): string {
  return (linha ?? "").trim().toUpperCase().replace(/^0+(?=\d)/, "");
}

/** Código da linha como está no Cadastro de Linhas ("1" -> "01" se o
 *  cadastro tem "01"). Sem correspondência única, devolve o próprio texto. */
export function buildLinhaDoCadastro(codigos: string[]): (linha: string) => string {
  const porChave = new Map<string, string | null>();
  for (const c of codigos) {
    const k = chaveLinha(c);
    porChave.set(k, porChave.has(k) && porChave.get(k) !== c ? null : c);
  }
  return (linha) => {
    const l = (linha ?? "").trim();
    if (codigos.includes(l)) return l;
    return porChave.get(chaveLinha(l)) ?? l;
  };
}

export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export type FiltrosHistorico = {
  linha: string[];
  empresa: string;
  grupo: string;
  diaTipo: string[];
  versao: string;
  referencia: string;
  alteracao: string;
  anoVig: string;
  mesVig: string;
  anoEnc: string;
  mesEnc: string;
  /** Período: vigência começando entre as datas (inclusive). */
  vigDe: string;
  vigAte: string;
  /** "vigente" = já começou e sem fim (ou fim no futuro); "encerrado" = fim já passou; "sem_fim" = sem encerramento. */
  situacao: string;
  ativo: string;
};

export const FILTROS_HISTORICO_VAZIOS: FiltrosHistorico = {
  linha: [], empresa: "__all", grupo: "__all", diaTipo: [], versao: "", referencia: "", alteracao: "",
  anoVig: "__all", mesVig: "__all", anoEnc: "__all", mesEnc: "__all", vigDe: "", vigAte: "", situacao: "__all", ativo: "__all",
};

/** Aplica os filtros do Histórico (Consultar e Relatório PDF usam os
 *  mesmos). Linha comparada por chaveLinha ("1" = "01"); Empresa e Grupo de
 *  Linha resolvidos pelo cadastro. */
export function filtrarHistorico(
  historico: Historico[],
  f: FiltrosHistorico,
  ctx: { empresaDaLinha: (linha: string) => string | null | undefined; grupoParaLinhas: Map<string, Set<string>> },
): Historico[] {
  const hoje = new Date().toISOString().slice(0, 10);
  const linhasSel = new Set(f.linha.map(chaveLinha));
  const diasSel = new Set(f.diaTipo);
  const grupoSel = f.grupo !== "__all" ? new Set(Array.from(ctx.grupoParaLinhas.get(f.grupo) ?? []).map(chaveLinha)) : null;
  const ref = f.referencia.trim().toLowerCase();
  const alt = f.alteracao.trim().toLowerCase();
  const versao = f.versao.trim();
  return historico.filter((h) => {
    if (linhasSel.size && !linhasSel.has(chaveLinha(h.linha))) return false;
    if (diasSel.size && !diasSel.has(h.dia_tipo ?? "")) return false;
    if (grupoSel && !grupoSel.has(chaveLinha(h.linha))) return false;
    if (f.empresa !== "__all" && ctx.empresaDaLinha(h.linha) !== f.empresa) return false;
    if (versao && String(h.versao ?? "") !== versao) return false;
    if (ref && !(h.referencia ?? "").toLowerCase().includes(ref)) return false;
    if (alt && !(h.alteracao ?? "").toLowerCase().includes(alt)) return false;
    if (f.anoVig !== "__all" && h.vigencia?.slice(0, 4) !== f.anoVig) return false;
    if (f.mesVig !== "__all" && h.vigencia?.slice(5, 7) !== f.mesVig) return false;
    if (f.anoEnc !== "__all" && h.encerramento?.slice(0, 4) !== f.anoEnc) return false;
    if (f.mesEnc !== "__all" && h.encerramento?.slice(5, 7) !== f.mesEnc) return false;
    if (f.vigDe && (!h.vigencia || h.vigencia < f.vigDe)) return false;
    if (f.vigAte && (!h.vigencia || h.vigencia > f.vigAte)) return false;
    if (f.ativo === "S" && h.ativo === false) return false;
    if (f.ativo === "N" && h.ativo !== false) return false;
    if (f.situacao !== "__all") {
      const comecou = !!h.vigencia && h.vigencia <= hoje;
      const encerrado = !!h.encerramento && h.encerramento < hoje;
      if (f.situacao === "vigente" && !(comecou && !encerrado)) return false;
      if (f.situacao === "encerrado" && !encerrado) return false;
      if (f.situacao === "futuro" && !(h.vigencia && h.vigencia > hoje)) return false;
      if (f.situacao === "sem_fim" && h.encerramento) return false;
    }
    return true;
  });
}

/** Texto curto dos filtros ativos (cabeçalho do PDF). */
export function resumoFiltrosHistorico(f: FiltrosHistorico): string[] {
  const out: string[] = [];
  const mes = (m: string) => MESES[Number(m) - 1] ?? m;
  const data = (d: string) => d.split("-").reverse().join("/");
  if (f.linha.length) out.push(`Linha: ${f.linha.join(", ")}`);
  if (f.empresa !== "__all") out.push(`Empresa: ${f.empresa}`);
  if (f.grupo !== "__all") out.push(`Grupo de Linha: ${f.grupo}`);
  if (f.diaTipo.length) out.push(`Dia tipo: ${f.diaTipo.join(", ")}`);
  if (f.versao.trim()) out.push(`Versão: ${f.versao.trim()}`);
  if (f.referencia.trim()) out.push(`Referência contém: ${f.referencia.trim()}`);
  if (f.alteracao.trim()) out.push(`Alteração contém: ${f.alteracao.trim()}`);
  if (f.anoVig !== "__all" || f.mesVig !== "__all") out.push(`Vigência: ${[f.mesVig !== "__all" ? mes(f.mesVig) : "", f.anoVig !== "__all" ? f.anoVig : ""].filter(Boolean).join(" de ")}`);
  if (f.anoEnc !== "__all" || f.mesEnc !== "__all") out.push(`Encerramento: ${[f.mesEnc !== "__all" ? mes(f.mesEnc) : "", f.anoEnc !== "__all" ? f.anoEnc : ""].filter(Boolean).join(" de ")}`);
  if (f.vigDe || f.vigAte) out.push(`Vigência entre ${f.vigDe ? data(f.vigDe) : "…"} e ${f.vigAte ? data(f.vigAte) : "…"}`);
  const sit: Record<string, string> = { vigente: "Vigente", encerrado: "Encerrado", futuro: "Começa no futuro", sem_fim: "Sem encerramento" };
  if (f.situacao !== "__all") out.push(`Situação: ${sit[f.situacao] ?? f.situacao}`);
  if (f.ativo !== "__all") out.push(`Ativo: ${f.ativo === "S" ? "Sim" : "Não"}`);
  return out.length ? out : ["Nenhum filtro aplicado"];
}
