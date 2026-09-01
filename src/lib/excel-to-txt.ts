import * as XLSX from "xlsx";

export interface ProcessedRecord {
  data: string; // DD-MM-AA
  dataSort: string; // YYYY-MM-DD for sorting
  linha: string;
  sentido: string;
  carro: string; // 5 digits
  partida: string; // HH:mm
  chegada: string; // HH:mm
  sourceFile: string;
}

export interface FileResult {
  fileName: string;
  records: ProcessedRecord[];
  error?: string;
  warnings: string[];
}

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Palavras-chave por coluna (correspondência flexível: acentos, espaços e pontuação ignorados) */
const HEADER_KEYWORDS: Record<string, string[]> = {
  entrada: ["entrada", "horaentrada", "horariodeentrada", "inicio", "real"],
  saida: ["saida", "horasaida", "horariodesaida", "fim", "real"],
  prefixo: ["prefixo", "carro", "veiculo"],
};

const squash = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, "");

function matchHeaderByTitle(normRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const used = new Set<number>();
  // prefixo primeiro (mais específico)
  for (const key of ["prefixo", "entrada", "saida"]) {
    const words = HEADER_KEYWORDS[key];
    const idx = normRow.findIndex(
      (c, i) => !used.has(i) && c !== "" && words.some((w) => c.includes(w)),
    );
    if (idx !== -1) {
      map[key] = idx;
      used.add(idx);
    }
  }
  return map;
}

/** Fallback: identifica as colunas pelo conteúdo das linhas de dados (posição das colunas) */
function detectByContent(
  rows: unknown[][],
  startIdx: number,
): { map: Record<string, number>; ok: boolean } {
  const width = Math.max(...rows.slice(startIdx, startIdx + 40).map((r) => (r ?? []).length), 0);
  const dateHits = new Array(width).fill(0);
  const numHits = new Array(width).fill(0);
  let sampled = 0;
  for (let i = startIdx; i < rows.length && sampled < 40; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || c === "")) continue;
    sampled++;
    for (let c = 0; c < width; c++) {
      const v = row[c];
      if (parseDateTime(v)) dateHits[c]++;
      else if (v != null && v !== "" && /^\d[\d\s.-]*$/.test(String(v).trim())) numHits[c]++;
    }
  }
  const dateCols = dateHits
    .map((n, i) => ({ n, i }))
    .filter((x) => x.n > 0)
    .sort((a, b) => a.i - b.i);
  if (dateCols.length < 2 || sampled === 0) return { map: {}, ok: false };
  const entrada = dateCols[0].i;
  const saida = dateCols[1].i;
  const prefCol = numHits
    .map((n, i) => ({ n, i }))
    .filter((x) => x.i !== entrada && x.i !== saida && x.n >= Math.ceil(sampled / 2))
    .sort((a, b) => b.n - a.n || a.i - b.i)[0];
  return {
    map: { entrada, saida, ...(prefCol ? { prefixo: prefCol.i } : {}) },
    ok: true,
  };
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function findHeaderRow(
  rows: unknown[][],
): { idx: number; map: Record<string, number>; source: "titulo" | "conteudo" } | null {
  // 1) por título (flexível)
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const normRow = (rows[i] ?? []).map(squash);
    const map = matchHeaderByTitle(normRow);
    if (map.entrada != null && map.saida != null) {
      if (map.prefixo == null) {
        const byContent = detectByContent(rows, i + 1);
        if (byContent.map.prefixo != null) map.prefixo = byContent.map.prefixo;
      }
      if (map.prefixo != null) return { idx: i, map, source: "titulo" };
    }
  }
  // 2) por conteúdo/posição — encontra a primeira linha de dados com datas
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] ?? [];
    const dates = row.filter((c) => parseDateTime(c)).length;
    if (dates >= 2) {
      const byContent = detectByContent(rows, i);
      if (byContent.ok && byContent.map.prefixo != null) {
        return { idx: i - 1, map: byContent.map, source: "conteudo" };
      }
    }
  }
  return null;
}


function parseDateTime(value: unknown): { date: string; time: string; sortDate: string } | null {
  if (value == null || value === "") return null;
  // Excel serial number
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d) return null;
    const dd = String(d.D).padStart(2, "0");
    const mm = String(d.M).padStart(2, "0");
    const yy = String(d.y).padStart(4, "0").slice(-2);
    const hh = String(d.H).padStart(2, "0");
    const mi = String(d.M < 0 ? 0 : d.m).padStart(2, "0");
    return {
      date: `${dd}-${mm}-${yy}`,
      time: `${hh}:${mi}`,
      sortDate: `${String(d.y).padStart(4, "0")}-${mm}-${dd}`,
    };
  }
  if (value instanceof Date) {
    const dd = String(value.getDate()).padStart(2, "0");
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const yyyy = value.getFullYear();
    const yy = String(yyyy).slice(-2);
    const hh = String(value.getHours()).padStart(2, "0");
    const mi = String(value.getMinutes()).padStart(2, "0");
    return { date: `${dd}-${mm}-${yy}`, time: `${hh}:${mi}`, sortDate: `${yyyy}-${mm}-${dd}` };
  }
  const s = String(value).trim();
  // Format: "DD/MM/YYYY, HH:MM" or "DD/MM/YYYY HH:MM:SS"
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})[,\s]+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  const yy = yyyy.slice(-2);
  const hh = m[4].padStart(2, "0");
  const mi = m[5].padStart(2, "0");
  return { date: `${dd}-${mm}-${yy}`, time: `${hh}:${mi}`, sortDate: `${yyyy}-${mm}-${dd}` };
}

function padCarro(prefix: unknown): string {
  const digits = String(prefix ?? "").replace(/\D/g, "");
  if (!digits) return "00000";
  return digits.padStart(5, "0").slice(-5);
}

export async function processFile(
  file: File,
  linha: string,
  sentido: string,
): Promise<FileResult> {
  const warnings: string[] = [];
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames.find((n) => norm(n) === "dados1");
    if (!sheetName) {
      return {
        fileName: file.name,
        records: [],
        warnings,
        error: `Arquivo ${file.name} não possui a aba DADOS1.`,
      };
    }
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
    });
    const header = findHeaderRow(rows);
    if (!header) {
      return {
        fileName: file.name,
        records: [],
        warnings,
        error: `Arquivo ${file.name}: não foi possível identificar as colunas de entrada/saída e prefixo (nem pelo título, nem pelo conteúdo da aba DADOS1).`,
      };
    }
    if (header.source === "conteudo") {
      warnings.push(
        `Títulos não reconhecidos — colunas identificadas pela posição/conteúdo: entrada=${colLetter(header.map.entrada)}, saída=${colLetter(header.map.saida)}, prefixo=${colLetter(header.map.prefixo)}.`,
      );
    }

    const records: ProcessedRecord[] = [];
    for (let i = header.idx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => c == null || c === "")) continue;
      const entrada = parseDateTime(row[header.map.entrada]);
      const saida = parseDateTime(row[header.map.saida]);
      const prefixo = row[header.map.prefixo];
      if (!entrada || !saida) continue;
      records.push({
        data: entrada.date,
        dataSort: entrada.sortDate,
        linha,
        sentido,
        carro: padCarro(prefixo),
        partida: entrada.time,
        chegada: saida.time,
        sourceFile: file.name,
      });
    }
    return { fileName: file.name, records, warnings };
  } catch (e) {
    return {
      fileName: file.name,
      records: [],
      warnings,
      error: `Erro ao ler ${file.name}: ${(e as Error).message}`,
    };
  }
}

export function sortRecords(records: ProcessedRecord[]): ProcessedRecord[] {
  return [...records].sort((a, b) => {
    if (a.dataSort !== b.dataSort) return a.dataSort < b.dataSort ? -1 : 1;
    if (a.partida !== b.partida) return a.partida < b.partida ? -1 : 1;
    return 0;
  });
}

export function buildTxt(records: ProcessedRecord[]): string {
  return records
    .map(
      (r) =>
        `${r.data} ${r.linha} ${r.sentido} N ${r.carro} ${r.partida} ${r.chegada} 00000 00000 00000`,
    )
    .join("\r\n");
}

export function encodeWindows1252(text: string): Uint8Array {
  // ASCII-only output (digits, letters, spaces, dashes, colons) — Windows-1252 == ASCII for this set.
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 256 ? c : 63; // '?'
  }
  return out;
}
