// Template Excel ÚNICO para cadastro de Linhas + KM + Grupos de Linhas.
// Um arquivo, três abas — importa tudo de uma vez só.

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { Linha, ParametroKm, ParametroMulti } from "@/lib/data";

const HEADERS_LINHAS = [
  "linha", "empresa", "unidade", "grupo", "categoria",
  "antec_t1", "prest_t1",
  "antec_t2", "prest_t2",
  "antec_t3", "prest_t3",
] as const;

const HEADERS_KM = ["linha", "origem", "destino", "km", "descricao"] as const;

const HEADERS_GRUPOS = ["linha", "grupo_du", "tipo_dia"] as const;

export type ImportReport = {
  sheet: string;
  total: number;
  inserted: number;
  updated: number;
  errors: string[];
};

export type ImportReportGeral = {
  sheets: ImportReport[];
  totalErrors: number;
};

// ---------------------------------------------------------------------------
// EXPORTAÇÃO — gera o arquivo modelo (com dados atuais, se fornecidos)
// ---------------------------------------------------------------------------

export function exportTemplateUnificado(data?: {
  linhas?: Linha[];
  km?: ParametroKm[];
  multi?: ParametroMulti[];
}) {
  const wb = XLSX.utils.book_new();

  // --- Aba Linhas ---
  const linhasRows = data?.linhas?.length
    ? data.linhas.map((l) => ({
        linha: l.linha, empresa: l.empresa ?? "", unidade: l.unidade ?? "",
        grupo: l.ordem ?? "", categoria: l.categoria ?? "",
        antec_t1: l.antec_t1 ?? 0, prest_t1: l.prest_t1 ?? 0,
        antec_t2: l.antec_t2 ?? 0, prest_t2: l.prest_t2 ?? 0,
        antec_t3: l.antec_t3 ?? 0, prest_t3: l.prest_t3 ?? 0,
      }))
    : [{
        linha: "408M", empresa: "Empresa Exemplo", unidade: "Unidade 1",
        grupo: "1", categoria: "Alimentadora",
        antec_t1: 15, prest_t1: 10, antec_t2: 15, prest_t2: 10,
        antec_t3: 0, prest_t3: 0,
      }];
  const wsLinhas = XLSX.utils.json_to_sheet(linhasRows, { header: [...HEADERS_LINHAS] });
  wsLinhas["!cols"] = HEADERS_LINHAS.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, wsLinhas, "Linhas");

  // --- Aba KM ---
  const kmRows = data?.km?.length
    ? data.km.map((k) => ({
        linha: k.linha, origem: k.origem, destino: k.destino,
        km: k.km ?? 0, descricao: k.descricao ?? "",
      }))
    : [{ linha: "408M", origem: "Terminal A", destino: "Terminal B", km: 12.4, descricao: "Via Av. Principal" }];
  const wsKm = XLSX.utils.json_to_sheet(kmRows, { header: [...HEADERS_KM] });
  wsKm["!cols"] = HEADERS_KM.map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, wsKm, "KM");

  // --- Aba Grupos ---
  const gruposRows = data?.multi?.length
    ? data.multi.map((m) => ({ linha: m.linha, grupo_du: m.grupo_du, tipo_dia: m.tipo_dia }))
    : [{ linha: "408M", grupo_du: "Grupo 1", tipo_dia: "Útil" }];
  const wsGrupos = XLSX.utils.json_to_sheet(gruposRows, { header: [...HEADERS_GRUPOS] });
  wsGrupos["!cols"] = HEADERS_GRUPOS.map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, wsGrupos, "Grupos");

  // --- Aba Instruções ---
  const info = XLSX.utils.aoa_to_sheet([
    ["CADASTRO UNIFICADO — Linhas + KM + Grupos", "", ""],
    ["", "", ""],
    ["Este arquivo tem 3 abas: Linhas, KM e Grupos.", "", ""],
    ["Preencha as que quiser — não precisa preencher todas.", "", ""],
    ["Ao importar, cada aba é processada e gravada na tabela correspondente.", "", ""],
    ["", "", ""],
    ["Aba LINHAS", "", ""],
    ["Campo", "Descrição", "Obrigatório"],
    ["linha", "Código único da linha (ex: 408M)", "Sim"],
    ["empresa", "Nome da empresa operadora", "Não"],
    ["unidade", "Unidade operacional", "Não"],
    ["grupo", "Grupo/ordem para relatórios (texto livre, ex: 1, A, GRUPO-1)", "Não"],
    ["categoria", "Categoria (ex: Troncal, Alimentadora)", "Não"],
    ["antec_t1 / prest_t1", "Antecipação / prestação de contas turno 1 (min)", "Não (default 0)"],
    ["antec_t2 / prest_t2", "Antecipação / prestação de contas turno 2 (min)", "Não"],
    ["antec_t3 / prest_t3", "Antecipação / prestação de contas turno 3 (min)", "Não"],
    ["", "", ""],
    ["Aba KM", "", ""],
    ["Campo", "Descrição", "Obrigatório"],
    ["linha", "Código da linha (deve existir na aba Linhas ou já cadastrada)", "Sim"],
    ["origem", "Ponto de origem do trecho", "Sim"],
    ["destino", "Ponto de destino do trecho", "Sim"],
    ["km", "Quilometragem do trecho (use ponto ou vírgula decimal)", "Sim"],
    ["descricao", "Descrição / itinerário do trecho", "Não"],
    ["", "", ""],
    ["Aba GRUPOS", "", ""],
    ["Campo", "Descrição", "Obrigatório"],
    ["linha", "Código da linha", "Sim"],
    ["grupo_du", "Nome do grupo de linhas (dia útil, etc.)", "Sim"],
    ["tipo_dia", "Tipo de dia (Útil, Sábado, Domingo, etc.)", "Sim"],
    ["", "", ""],
    ["REGRAS GERAIS", "", ""],
    ["Import faz UPSERT (atualiza se já existir, insere se for novo).", "", ""],
    ["Linhas: chave = linha.", "", ""],
    ["KM: chave = linha + origem + destino.", "", ""],
    ["Grupos: chave = linha + grupo_du + tipo_dia.", "", ""],
    ["Linhas em branco em qualquer aba são ignoradas.", "", ""],
  ]);
  info["!cols"] = [{ wch: 22 }, { wch: 62 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, info, "Instruções");

  XLSX.writeFile(wb, `cadastro_unificado_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------------------------------------------------------------------------
// IMPORTAÇÃO — lê o arquivo modelo e grava as 3 tabelas
// ---------------------------------------------------------------------------

function numOrZero(v: any): number {
  if (v === "" || v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

async function importLinhasSheet(rows: Record<string, any>[]): Promise<ImportReport> {
  const errors: string[] = [];
  const payload: any[] = [];
  const existentesRes = await supabase.from("linhas").select("linha");
  const existentes = new Set(((existentesRes.data ?? []) as any[]).map((l) => l.linha));
  let inserted = 0, updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linha = String(r.linha ?? "").trim();
    if (!linha) continue;
    const item: any = {
      linha,
      empresa: String(r.empresa ?? "").trim() || null,
      unidade: String(r.unidade ?? "").trim() || null,
      ordem: (() => {
        const v = r.grupo !== "" && r.grupo != null ? r.grupo : r.ordem;
        return v !== "" && v != null ? String(v).trim() || null : null;
      })(),
      categoria: String(r.categoria ?? "").trim() || null,
      antec_t1: numOrZero(r.antec_t1), prest_t1: numOrZero(r.prest_t1),
      antec_t2: numOrZero(r.antec_t2), prest_t2: numOrZero(r.prest_t2),
      antec_t3: numOrZero(r.antec_t3), prest_t3: numOrZero(r.prest_t3),
      updated_at: new Date().toISOString(),
    };
    if (existentes.has(linha)) updated++; else inserted++;
    payload.push(item);
  }

  const chunkSize = 200;
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { error } = await supabase.from("linhas").upsert(chunk, { onConflict: "linha" });
    if (error) errors.push(error.message);
  }

  return { sheet: "Linhas", total: payload.length, inserted, updated, errors };
}

async function importKmSheet(rows: Record<string, any>[]): Promise<ImportReport> {
  const errors: string[] = [];
  const payload: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linha = String(r.linha ?? "").trim();
    const origem = String(r.origem ?? "").trim();
    const destino = String(r.destino ?? "").trim();
    if (!linha || !origem || !destino) continue;
    payload.push({
      linha, origem, destino,
      km: numOrZero(r.km),
      descricao: String(r.descricao ?? "").trim() || null,
    });
  }

  // dedupe por chave composta, mantendo a última ocorrência
  const byKey = new Map<string, any>();
  payload.forEach((r) => byKey.set(`${r.linha}|${r.origem}|${r.destino}`.toUpperCase(), r));
  const rows2 = Array.from(byKey.values());

  const existentesRes = await supabase.from("parametro_km").select("linha,origem,destino").limit(10000);
  const existentes = new Set(
    ((existentesRes.data ?? []) as any[]).map((e) => `${e.linha}|${e.origem}|${e.destino}`.toUpperCase()),
  );
  let inserted = 0, updated = 0;
  rows2.forEach((r) => {
    const k = `${r.linha}|${r.origem}|${r.destino}`.toUpperCase();
    if (existentes.has(k)) updated++; else inserted++;
  });

  const chunkSize = 500;
  for (let i = 0; i < rows2.length; i += chunkSize) {
    const chunk = rows2.slice(i, i + chunkSize);
    const { error } = await supabase.from("parametro_km").upsert(chunk, { onConflict: "linha,origem,destino" });
    if (error) errors.push(error.message);
  }

  return { sheet: "KM", total: rows2.length, inserted, updated, errors };
}

async function importGruposSheet(rows: Record<string, any>[]): Promise<ImportReport> {
  const errors: string[] = [];
  const payload: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linha = String(r.linha ?? "").trim();
    const grupo_du = String(r.grupo_du ?? "").trim();
    const tipo_dia = String(r.tipo_dia ?? "").trim();
    if (!linha || !grupo_du || !tipo_dia) continue;
    payload.push({ linha, grupo_du, tipo_dia });
  }

  const byKey = new Map<string, any>();
  payload.forEach((r) => byKey.set(`${r.linha}|${r.grupo_du}|${r.tipo_dia}`.toUpperCase(), r));
  const rows2 = Array.from(byKey.values());

  const existentesRes = await supabase.from("parametro_multilinha").select("linha,grupo_du,tipo_dia").limit(10000);
  const existentes = new Set(
    ((existentesRes.data ?? []) as any[]).map((e) => `${e.linha}|${e.grupo_du}|${e.tipo_dia}`.toUpperCase()),
  );
  let inserted = 0, updated = 0;
  rows2.forEach((r) => {
    const k = `${r.linha}|${r.grupo_du}|${r.tipo_dia}`.toUpperCase();
    if (existentes.has(k)) updated++; else inserted++;
  });

  const chunkSize = 500;
  for (let i = 0; i < rows2.length; i += chunkSize) {
    const chunk = rows2.slice(i, i + chunkSize);
    const { error } = await supabase.from("parametro_multilinha").upsert(chunk, { onConflict: "linha,grupo_du,tipo_dia" });
    if (error) errors.push(error.message);
  }

  return { sheet: "Grupos", total: rows2.length, inserted, updated, errors };
}

export async function importTemplateUnificado(file: File): Promise<ImportReportGeral> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheets: ImportReport[] = [];

  const wsLinhas = wb.Sheets["Linhas"];
  if (wsLinhas) {
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wsLinhas, { defval: "" });
    sheets.push(await importLinhasSheet(rows));
  }

  const wsKm = wb.Sheets["KM"];
  if (wsKm) {
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wsKm, { defval: "" });
    sheets.push(await importKmSheet(rows));
  }

  const wsGrupos = wb.Sheets["Grupos"];
  if (wsGrupos) {
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wsGrupos, { defval: "" });
    sheets.push(await importGruposSheet(rows));
  }

  if (!sheets.length) {
    throw new Error("Nenhuma aba reconhecida (esperado: Linhas, KM e/ou Grupos)");
  }

  const totalErrors = sheets.reduce((acc, s) => acc + s.errors.length, 0);
  return { sheets, totalErrors };
}
