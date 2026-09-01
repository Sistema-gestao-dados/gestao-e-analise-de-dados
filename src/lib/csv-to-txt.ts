import type { ProcessedRecord } from "./excel-to-txt";

export interface CsvFileResult {
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

const squash = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, "");

/** Palavras-chave flexíveis por coluna (acentos/espaços/pontuação ignorados) */
const COLS: Record<string, string[]> = {
  linha: ["linha"],
  data: ["data"],
  sentido: ["sentido"],
  prefixo: ["prefixo", "carro", "veiculo"],
  horaInicial: ["horainicial", "inicialrealizado", "inicio", "partida", "saida"],
  horaFinal: ["horafinal", "finalrealizado", "fim", "chegada", "termino"],
};

const COL_LABELS: Record<string, string> = {
  linha: "LINHA",
  data: "DATA",
  sentido: "SENTIDO",
  prefixo: "PREFIXO",
  horaInicial: "HORA INICIAL REALIZADO",
  horaFinal: "HORA FINAL REALIZADO",
};


function detectDelimiter(line: string): string {
  const counts = [";", ",", "\t"].map((d) => [d, line.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ";";
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (c === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** "425D - ALCÂNTARA X CAMPO GRANDE" -> "000425D" */
export function formatLinha(raw: string): string {
  const code = String(raw ?? "").split("-")[0].trim().toUpperCase();
  if (!code) return "";
  return code.padStart(7, "0").slice(-7);
}

/** "185015 - MAUI" -> "85015" */
export function formatCarro(raw: string): string {
  const digits = String(raw ?? "").split("-")[0].replace(/\D/g, "");
  if (!digits) return "00000";
  return digits.padStart(5, "0").slice(-5);
}

/** "Ida" -> "I", "Volta" -> "V" */
export function formatSentido(raw: string): string {
  const n = norm(raw);
  if (n.startsWith("i")) return "I";
  if (n.startsWith("v")) return "V";
  return "";
}

/** "02/08/2026" -> { date: "02-08-26", sortDate: "2026-08-02" } */
function formatData(raw: string): { date: string; sortDate: string } | null {
  const m = String(raw ?? "").match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return { date: `${dd}-${mm}-${yyyy.slice(-2)}`, sortDate: `${yyyy}-${mm}-${dd}` };
}

/** "02/08/2026 04:18:49" -> "04:18" */
function formatHora(raw: string): string | null {
  const m = String(raw ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export async function processCsvFile(file: File): Promise<CsvFileResult> {
  const warnings: string[] = [];
  try {
    let text = await file.text();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (!lines.length) {
      return { fileName: file.name, records: [], warnings, error: "Arquivo vazio." };
    }
    const delim = detectDelimiter(lines[0]);
    const rawHeader = splitLine(lines[0], delim);
    const header = rawHeader.map(squash);
    const dataRows = lines.slice(1, 41).map((l) => splitLine(l, delim));

    // 1) por título (correspondência flexível)
    const map: Record<string, number> = {};
    const used = new Set<number>();
    for (const key of ["linha", "data", "sentido", "prefixo", "horaInicial", "horaFinal"]) {
      const words = COLS[key];
      const idx = header.findIndex(
        (h, i) => !used.has(i) && h !== "" && words.some((w) => h.includes(w)),
      );
      if (idx !== -1) {
        map[key] = idx;
        used.add(idx);
      }
    }

    // 2) fallback pelo conteúdo/posição das colunas
    const width = Math.max(rawHeader.length, ...dataRows.map((r) => r.length), 0);
    const isDateOnly = (v: string) => /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(v.trim());
    const isDateTime = (v: string) => /\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}.*\d{1,2}:\d{2}/.test(v);
    const isSentido = (v: string) => /^(ida|volta)/.test(norm(v));
    const isCode = (v: string) => /^[0-9a-z]+\s*-\s*\S/i.test(v.trim());
    const ratio = (fn: (v: string) => boolean, c: number) => {
      const vals = dataRows.map((r) => r[c] ?? "").filter((v) => v.trim() !== "");
      if (!vals.length) return 0;
      return vals.filter(fn).length / vals.length;
    };
    const cols = Array.from({ length: width }, (_, c) => c);
    const free = (c: number) => !Object.values(map).includes(c);
    const dateTimeCols = cols.filter((c) => ratio(isDateTime, c) >= 0.6);
    const inferred: string[] = [];
    const assign = (key: string, c: number | undefined) => {
      if (map[key] != null || c == null) return;
      map[key] = c;
      inferred.push(key);
    };
    assign(
      "data",
      cols.find((c) => free(c) && ratio(isDateOnly, c) >= 0.6),
    );
    assign(
      "sentido",
      cols.find((c) => free(c) && ratio(isSentido, c) >= 0.6),
    );
    assign(
      "horaInicial",
      dateTimeCols.filter(free)[0],
    );
    assign(
      "horaFinal",
      dateTimeCols.filter(free)[0],
    );
    const codeCols = cols.filter((c) => free(c) && ratio(isCode, c) >= 0.6);
    assign("linha", codeCols[0]);
    assign("prefixo", codeCols[0]);

    const colLetter = (key: string) => {
      let n = map[key] + 1;
      let s = "";
      while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
      }
      return s;
    };

    const missing = Object.keys(COLS).filter((k) => map[k] == null);
    if (missing.length) {
      return {
        fileName: file.name,
        records: [],
        warnings,
        error: `Arquivo ${file.name}: não foi possível identificar a(s) coluna(s): ${missing
          .map((k) => COL_LABELS[k])
          .join(", ")} — nem pelo título, nem pelo conteúdo.`,
      };
    }
    if (inferred.length) {
      warnings.push(
        `Título(s) não reconhecido(s) — coluna(s) identificada(s) pelo conteúdo/posição: ${inferred
          .map((k) => `${COL_LABELS[k]}=${colLetter(k)}`)
          .join(", ")}.`,
      );
    }

    const colLabel = (key: string) => rawHeader[map[key]]?.trim() || COL_LABELS[key];


    const records: ProcessedRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitLine(lines[i], delim);
      const data = formatData(cols[map.data]);
      const partida = formatHora(cols[map.horaInicial]);
      const chegada = formatHora(cols[map.horaFinal]);
      const linha = formatLinha(cols[map.linha]);
      const sentido = formatSentido(cols[map.sentido]);

      const problems: string[] = [];
      const check = (ok: boolean, key: string) => {
        if (ok) return;
        const raw = String(cols[map[key]] ?? "").trim();
        problems.push(
          `coluna ${colLetter(key)} "${colLabel(key)}" ${raw ? `valor inválido: "${raw}"` : "vazia"}`,
        );
      };
      check(!!linha, "linha");
      check(!!data, "data");
      check(!!sentido, "sentido");
      check(!!partida, "horaInicial");
      check(!!chegada, "horaFinal");

      if (problems.length) {
        warnings.push(`Linha ${i + 1} ignorada — ${problems.join("; ")}.`);
        continue;
      }
      records.push({
        data: data!.date,
        dataSort: data!.sortDate,
        linha,
        sentido,
        carro: formatCarro(cols[map.prefixo]),
        partida: partida!,
        chegada: chegada!,
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
