// Export/Import template Excel para cadastro de Linhas.
// Inclui campos de antecipação e prestação de contas por turno (min).

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { Linha } from "@/lib/data";

const HEADERS = [
  "linha", "empresa", "unidade", "ordem", "categoria",
  "antec_t1", "prest_t1",
  "antec_t2", "prest_t2",
  "antec_t3", "prest_t3",
] as const;

export function exportTemplate(linhas: Linha[] = []) {
  const rows = linhas.length
    ? linhas.map((l) => ({
        linha: l.linha, empresa: l.empresa ?? "", unidade: l.unidade ?? "",
        ordem: l.ordem ?? "", categoria: l.categoria ?? "",
        antec_t1: l.antec_t1 ?? 0, prest_t1: l.prest_t1 ?? 0,
        antec_t2: l.antec_t2 ?? 0, prest_t2: l.prest_t2 ?? 0,
        antec_t3: l.antec_t3 ?? 0, prest_t3: l.prest_t3 ?? 0,
      }))
    : [{
        linha: "408M", empresa: "Empresa Exemplo", unidade: "Unidade 1",
        ordem: 1, categoria: "Alimentadora",
        antec_t1: 15, prest_t1: 10, antec_t2: 15, prest_t2: 10,
        antec_t3: 0, prest_t3: 0,
      }];
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...HEADERS] });
  ws["!cols"] = HEADERS.map(() => ({ wch: 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Linhas");

  // Aba de instruções
  const info = XLSX.utils.aoa_to_sheet([
    ["Campo", "Descrição", "Obrigatório"],
    ["linha", "Código único da linha (ex: 408M)", "Sim"],
    ["empresa", "Nome da empresa operadora", "Não"],
    ["unidade", "Unidade operacional", "Não"],
    ["ordem", "Ordem numérica para relatórios", "Não"],
    ["categoria", "Categoria (ex: Troncal, Alimentadora)", "Não"],
    ["antec_t1", "Antecipação turno 1 (minutos)", "Não (default 0)"],
    ["prest_t1", "Prestação de contas turno 1 (minutos)", "Não (default 0)"],
    ["antec_t2", "Antecipação turno 2 (minutos)", "Não"],
    ["prest_t2", "Prestação turno 2 (minutos)", "Não"],
    ["antec_t3", "Antecipação turno 3 / aproveitamento (minutos)", "Não"],
    ["prest_t3", "Prestação turno 3 (minutos)", "Não"],
    ["", "", ""],
    ["REGRAS", "", ""],
    ["Import faz UPSERT por 'linha'.", "", ""],
    ["Linhas existentes serão ATUALIZADAS.", "", ""],
    ["Linhas novas serão INSERIDAS.", "", ""],
  ]);
  info["!cols"] = [{ wch: 14 }, { wch: 60 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, info, "Instruções");

  XLSX.writeFile(wb, `linhas_template_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export type ImportReport = {
  total: number;
  inserted: number;
  updated: number;
  errors: { row: number; reason: string }[];
};

export async function importTemplate(file: File): Promise<ImportReport> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets["Linhas"] ?? wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Planilha 'Linhas' não encontrada");
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

  const errors: ImportReport["errors"] = [];
  const payload: any[] = [];

  const existentesRes = await supabase.from("linhas").select("linha");
  const existentes = new Set(((existentesRes.data ?? []) as any[]).map((l) => l.linha));
  let inserted = 0, updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linha = String(r.linha ?? "").trim();
    if (!linha) { errors.push({ row: i + 2, reason: "Campo 'linha' vazio" }); continue; }
    const num = (k: string): number => {
      const v = r[k]; if (v === "" || v == null) return 0;
      const n = Number(v); return Number.isFinite(n) ? n : 0;
    };
    const item: any = {
      linha,
      empresa: String(r.empresa ?? "").trim() || null,
      unidade: String(r.unidade ?? "").trim() || null,
      ordem: r.ordem !== "" && r.ordem != null ? Number(r.ordem) || null : null,
      categoria: String(r.categoria ?? "").trim() || null,
      antec_t1: num("antec_t1"), prest_t1: num("prest_t1"),
      antec_t2: num("antec_t2"), prest_t2: num("prest_t2"),
      antec_t3: num("antec_t3"), prest_t3: num("prest_t3"),
      updated_at: new Date().toISOString(),
    };
    if (existentes.has(linha)) updated++; else inserted++;
    payload.push(item);
  }

  // upsert em lotes
  const chunkSize = 200;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase.from("linhas").upsert(chunk, { onConflict: "linha" });
    if (error) errors.push({ row: -1, reason: error.message });
  }

  return { total: rows.length, inserted, updated, errors };
}
