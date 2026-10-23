// Passageiros e receita por linha/dia — planilha "DADOS PAX".
//
// FORMATO DA PLANILHA ("largo"):
//   linha 1: "Linha" + código da linha, repetido nas 6 colunas do bloco
//            (células mescladas — só a 1ª tem o valor)
//   linha 2: Ano | Mes | Data | Viagens Realizadas | KM | Transportados |
//            Pagantes | Receita | Gratuidades | (próxima linha...) ...
//   demais : uma linha por dia (coluna Data = data), mais linhas "Totais"
//            (geral do ano e de cada mês) que servem só pra CONFERIR a soma.
//   "-" num bloco = a linha não rodou naquele dia (sem registro no banco).
//
// Empresa/Grupo/Unidade saem do cadastro de `linhas` (empresa, ordem,
// unidade) — a planilha não tem estação, então não existe exceção por
// estação aqui (diferente de `viagens`).

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllPaginado } from "@/lib/fetch-paginado";

export type PassageiroDia = {
  linha: string;
  data: string; // YYYY-MM-DD
  viagens: number | null;
  km: number | null;
  transportados: number | null;
  pagantes: number | null;
  receita: number | null;
  gratuidades: number | null;
};

export const METRICAS = ["viagens", "km", "transportados", "pagantes", "receita", "gratuidades"] as const;
export type Metrica = (typeof METRICAS)[number];

// Cabeçalho da planilha -> campo. Comparação sem acento/maiúscula.
const CABECALHOS: Record<string, Metrica> = {
  "viagens realizadas": "viagens",
  viagens: "viagens",
  km: "km",
  transportados: "transportados",
  pagantes: "pagantes",
  receita: "receita",
  gratuidades: "gratuidades",
};

const norm = (s: unknown) =>
  String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Número de uma célula: número cru, ou texto tipo "1.294,00", "1,294.00",
 *  "R$16.927,50". "-" / vazio = null. */
function numCelula(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!s || s === "-") return null;
  const ultVirgula = s.lastIndexOf(","), ultPonto = s.lastIndexOf(".");
  // O separador decimal é o que aparece por último.
  if (ultVirgula > ultPonto) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Data de uma célula: serial do Excel, Date, "01/08/2026" ou "2026-08-01". */
function dataCelula(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || !d.y) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export type ResultadoPlanilha = {
  registros: PassageiroDia[];
  /** (linha, data) com "-" — a linha não rodou nesse dia. */
  semOperacao: { linha: string; data: string }[];
  linhas: string[];
  datas: string[];
  /** Diferenças entre a soma dos dias e as linhas "Totais" do mês. */
  divergencias: string[];
  avisos: string[];
};

/** Lê a planilha DADOS PAX (1ª aba que tiver o cabeçalho esperado). */
export function parsePlanilhaPax(wb: XLSX.WorkBook): ResultadoPlanilha {
  for (const nome of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, raw: true, defval: "" });
    // Linha de cabeçalho = a que tem "Viagens Realizadas"/"Transportados".
    const iCab = rows.findIndex((r) => r.some((c) => norm(c) === "transportados"));
    if (iCab < 1) continue;
    return lerAba(rows, iCab);
  }
  throw new Error('Não encontrei o cabeçalho da planilha (coluna "Transportados"). Confira se é a planilha DADOS PAX.');
}

function lerAba(rows: unknown[][], iCab: number): ResultadoPlanilha {
  const cab = rows[iCab].map(norm);
  const linhaRow = rows[iCab - 1];
  const iData = cab.indexOf("data");
  const iMes = cab.indexOf("mes");
  if (iData < 0) throw new Error('Coluna "Data" não encontrada no cabeçalho.');

  // Blocos: cada coluna com cabeçalho de métrica pertence à última linha
  // vista na linha de cima (células mescladas só têm o valor na 1ª).
  type Bloco = { linha: string; cols: Partial<Record<Metrica, number>> };
  const blocos = new Map<string, Bloco>();
  let linhaAtual = "";
  for (let c = 0; c < cab.length; c++) {
    const nomeLinha = String(linhaRow[c] ?? "").trim();
    if (nomeLinha && norm(nomeLinha) !== "linha") linhaAtual = nomeLinha;
    const m = CABECALHOS[cab[c]];
    if (!m || !linhaAtual) continue;
    if (!blocos.has(linhaAtual)) blocos.set(linhaAtual, { linha: linhaAtual, cols: {} });
    blocos.get(linhaAtual)!.cols[m] = c;
  }
  if (!blocos.size) throw new Error("Nenhuma linha de ônibus encontrada acima do cabeçalho.");

  const registros: PassageiroDia[] = [];
  const semOperacao: { linha: string; data: string }[] = [];
  const datas = new Set<string>();
  const avisos: string[] = [];
  const divergencias: string[] = [];

  // Soma por mês (YYYY-MM) e linha, pra bater com as linhas "Totais".
  const somaMes = new Map<string, Record<Metrica, number>>();
  const totaisMes: { mesRotulo: string; mesChave: string | null; row: unknown[] }[] = [];

  for (let i = iCab + 1; i < rows.length; i++) {
    const r = rows[i];
    const data = dataCelula(r[iData]);
    if (!data) {
      if (norm(r[iData]) === "totais" && iMes >= 0) totaisMes.push({ mesRotulo: String(r[iMes]), mesChave: null, row: r });
      continue;
    }
    datas.add(data);
    for (const b of blocos.values()) {
      const valores = {} as Record<Metrica, number | null>;
      let algum = false;
      for (const m of METRICAS) {
        const c = b.cols[m];
        const v = c == null ? null : numCelula(r[c]);
        valores[m] = v;
        if (v != null) algum = true;
      }
      if (!algum) { semOperacao.push({ linha: b.linha, data }); continue; }
      registros.push({ linha: b.linha, data, ...valores });
      const k = `${data.slice(0, 7)}||${b.linha}`;
      const s = somaMes.get(k) ?? { viagens: 0, km: 0, transportados: 0, pagantes: 0, receita: 0, gratuidades: 0 };
      for (const m of METRICAS) s[m] += valores[m] ?? 0;
      somaMes.set(k, s);
    }
  }

  // "Totais" do mês: o rótulo vem como "ago"/"set"... — casa com o mês dos
  // dias que vêm logo abaixo dele na planilha.
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const anos = new Set(Array.from(datas, (d) => d.slice(0, 4)));
  for (const t of totaisMes) {
    const idx = MESES.indexOf(norm(t.mesRotulo).slice(0, 3));
    if (idx < 0 || anos.size !== 1) continue;
    const mesChave = `${[...anos][0]}-${String(idx + 1).padStart(2, "0")}`;
    for (const b of blocos.values()) {
      const s = somaMes.get(`${mesChave}||${b.linha}`);
      for (const m of METRICAS) {
        const c = b.cols[m];
        const tot = c == null ? null : numCelula(t.row[c]);
        if (tot == null) continue;
        const soma = s?.[m] ?? 0;
        if (Math.abs(soma - tot) > 0.01) divergencias.push(`Linha ${b.linha}, ${t.mesRotulo}, ${m}: soma dos dias ${soma} ≠ total ${tot}`);
      }
    }
  }
  if (!totaisMes.length) avisos.push("A planilha não tem linhas de \"Totais\" por mês — a conferência das somas foi pulada.");

  return {
    registros,
    semOperacao,
    linhas: Array.from(blocos.keys()),
    datas: Array.from(datas).sort(),
    divergencias,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------

const SELECT = "id,linha,data,viagens,km,transportados,pagantes,receita,gratuidades";

/** Registros entre `inicio` e `fim` (inclusive, YYYY-MM-DD). */
export async function fetchPassageiros(inicio: string, fim: string): Promise<PassageiroDia[]> {
  const rows = await fetchAllPaginado<PassageiroDia & { id: string }>("passageiros_diario", SELECT, {
    filtro: (q) => q.gte("data", inicio).lte("data", fim),
  });
  return rows.map((r) => ({
    linha: r.linha,
    data: r.data,
    viagens: r.viagens,
    km: r.km == null ? null : Number(r.km),
    transportados: r.transportados,
    pagantes: r.pagantes,
    receita: r.receita == null ? null : Number(r.receita),
    gratuidades: r.gratuidades,
  }));
}

export type MesImportado = { mes: string; dias: number; linhas: number; registros: number; inicio: string; fim: string };

export async function fetchMesesImportados(): Promise<MesImportado[]> {
  const { data, error } = await supabase.rpc("passageiros_diario_meses");
  if (error) throw error;
  return (data ?? []).map((m) => ({ ...m, dias: Number(m.dias), linhas: Number(m.linhas), registros: Number(m.registros) }));
}

/** Grava (upsert por linha+data) e apaga os dias "-" das linhas do arquivo
 *  — reimportar uma planilha corrigida deixa o banco igual ao arquivo. */
export async function salvarPassageiros(
  registros: PassageiroDia[],
  semOperacao: { linha: string; data: string }[],
  arquivo: string,
  onProgresso?: (feitos: number, total: number) => void,
): Promise<{ gravados: number; removidos: number }> {
  const LOTE = 1000;
  let gravados = 0;
  for (let i = 0; i < registros.length; i += LOTE) {
    const lote = registros.slice(i, i + LOTE).map((r) => ({ ...r, arquivo }));
    const { error } = await supabase.from("passageiros_diario").upsert(lote, { onConflict: "linha,data" });
    if (error) throw error;
    gravados += lote.length;
    onProgresso?.(gravados, registros.length);
  }
  let removidos = 0;
  const porLinha = new Map<string, string[]>();
  for (const s of semOperacao) {
    if (!porLinha.has(s.linha)) porLinha.set(s.linha, []);
    porLinha.get(s.linha)!.push(s.data);
  }
  for (const [linha, datas] of porLinha) {
    const { error, count } = await supabase
      .from("passageiros_diario")
      .delete({ count: "exact" })
      .eq("linha", linha)
      .in("data", datas);
    if (error) throw error;
    removidos += count ?? 0;
  }
  return { gravados, removidos };
}

export async function excluirPeriodo(inicio: string, fim: string): Promise<number> {
  const { error, count } = await supabase
    .from("passageiros_diario")
    .delete({ count: "exact" })
    .gte("data", inicio)
    .lte("data", fim);
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Agregação
// ---------------------------------------------------------------------------

export type Totais = Record<Metrica, number> & { dias: number; registros: number };

export const totaisVazios = (): Totais => ({
  viagens: 0, km: 0, transportados: 0, pagantes: 0, receita: 0, gratuidades: 0, dias: 0, registros: 0,
});

export function somar(rows: PassageiroDia[]): Totais {
  const t = totaisVazios();
  const dias = new Set<string>();
  for (const r of rows) {
    for (const m of METRICAS) t[m] += r[m] ?? 0;
    dias.add(r.data);
  }
  t.dias = dias.size;
  t.registros = rows.length;
  return t;
}

/** Indicadores derivados. null quando o divisor é zero. */
export function indicadores(t: Totais) {
  const div = (a: number, b: number) => (b ? a / b : null);
  return {
    paxPorViagem: div(t.transportados, t.viagens),
    ipk: div(t.transportados, t.km), // passageiros por km
    receitaPorKm: div(t.receita, t.km),
    tarifaMedia: div(t.receita, t.pagantes),
    pctGratuidade: div(t.gratuidades * 100, t.transportados),
    mediaDiaTransportados: div(t.transportados, t.dias),
    mediaDiaReceita: div(t.receita, t.dias),
  };
}

export type Granularidade = "dia" | "semana" | "mes";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES_ROTULO = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const parseISO = (d: string) => new Date(`${d}T12:00:00`);
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function diaSemana(data: string): number {
  return parseISO(data).getDay();
}

/** Tipo de dia pelo calendário (sem feriados — a planilha não informa). */
export function tipoDiaCalendario(data: string): "Dias úteis" | "Sábado" | "Domingo" {
  const d = diaSemana(data);
  return d === 0 ? "Domingo" : d === 6 ? "Sábado" : "Dias úteis";
}

/** Chave ordenável + rótulo do período. Semana começa na segunda-feira. */
export function periodoDe(data: string, g: Granularidade): { chave: string; rotulo: string } {
  if (g === "dia") return { chave: data, rotulo: `${ddmm(data)} ${DIAS_SEMANA[diaSemana(data)]}` };
  if (g === "mes") {
    const m = Number(data.slice(5, 7)) - 1;
    return { chave: data.slice(0, 7), rotulo: `${MESES_ROTULO[m]}/${data.slice(0, 4)}` };
  }
  const d = parseISO(data);
  const desloc = (d.getDay() + 6) % 7; // segunda = 0
  d.setDate(d.getDate() - desloc);
  const ini = toISO(d);
  d.setDate(d.getDate() + 6);
  return { chave: ini, rotulo: `${ddmm(ini)} a ${ddmm(toISO(d))}` };
}

export function addDias(data: string, n: number): string {
  const d = parseISO(data);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function difDias(inicio: string, fim: string): number {
  return Math.round((parseISO(fim).getTime() - parseISO(inicio).getTime()) / 86400000) + 1;
}

export const fmtNum = (v: number | null | undefined, casas = 0) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const fmtReais = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Variação % de `b` (atual) sobre `a` (anterior). null se `a` = 0. */
export function variacao(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}
