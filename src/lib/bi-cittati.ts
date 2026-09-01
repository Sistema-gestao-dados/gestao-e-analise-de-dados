export type ConvertedRow = { excelRow: number; date: string; text: string };
export type RowError = { excelRow: number; reason: string; snippet: string };
export type ConversionResult = {
  totalRows: number;
  records: ConvertedRow[];
  errors: RowError[];
};

const pad = (v: string, len: number) => v.padStart(len, "0");

const cellToString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

export function formatDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${pad(String(value.getDate()), 2)}-${pad(String(value.getMonth() + 1), 2)}-${String(
      value.getFullYear(),
    ).slice(-2)}`;
  }

  if (typeof value === "number" && isFinite(value)) {
    // Excel serial date (1900 system)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return `${pad(String(d.getUTCDate()), 2)}-${pad(String(d.getUTCMonth() + 1), 2)}-${String(
      d.getUTCFullYear(),
    ).slice(-2)}`;
  }

  const raw = cellToString(value);
  if (!raw) return null;

  // ISO: yyyy-mm-dd(Thh:mm...)
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]!.slice(-2)}`;

  // dd/mm/yyyy or dd-mm-yy (also accepts dd.mm.yyyy)
  const br = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return `${pad(String(day), 2)}-${pad(String(month), 2)}-${br[3]!.slice(-2)}`;
  }

  return null;
}

export function formatLine(value: unknown): string | null {
  const raw = cellToString(value);
  if (!raw) return null;
  const code = (raw.split("-")[0] ?? "").trim().replace(/\s+/g, "").toUpperCase();
  if (!code) return null;
  const trimmed = code.length > 7 ? code.slice(-7) : code;
  return pad(trimmed, 7);
}

export function formatDirection(value: unknown): string | null {
  const raw = cellToString(value).toUpperCase();
  if (!raw) return null;
  if (raw.startsWith("IDA")) return "I";
  if (raw.startsWith("VOLTA")) return "V";
  return null;
}

export function formatCar(value: unknown): string | null {
  let raw = cellToString(value);
  if (!raw) return null;
  if (typeof value === "number") raw = String(Math.trunc(value));
  raw = raw.replace(/\s+/g, "");
  if (!raw) return null;
  return raw.length > 5 ? raw.slice(-5) : pad(raw, 5);
}

export function formatTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${pad(String(value.getHours()), 2)}:${pad(String(value.getMinutes()), 2)}`;
  }

  if (typeof value === "number" && isFinite(value)) {
    const frac = value - Math.floor(value);
    const totalMinutes = Math.round(frac * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${pad(String(h), 2)}:${pad(String(m), 2)}`;
  }

  const raw = cellToString(value);
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(String(h), 2)}:${pad(String(min), 2)}`;
}

const IDX = { date: 1, line: 2, car: 5, direction: 6, start: 8, end: 12 };

export function convertRows(rows: unknown[][]): ConversionResult {
  const records: ConvertedRow[] = [];
  const errors: RowError[] = [];
  let started = false;
  let totalRows = 0;

  rows.forEach((row, i) => {
    const excelRow = i + 1;
    const get = (idx: number) => (row ? row[idx] : undefined);

    const fields = [IDX.date, IDX.line, IDX.car, IDX.direction, IDX.start, IDX.end].map((idx) =>
      cellToString(get(idx)),
    );
    const allEmpty = fields.every((f) => f === "");

    const date = formatDate(get(IDX.date));
    const line = formatLine(get(IDX.line));
    const car = formatCar(get(IDX.car));
    const direction = formatDirection(get(IDX.direction));
    const start = formatTime(get(IDX.start));
    const end = formatTime(get(IDX.end));

    const valid = date && line && car && direction && start && end;

    // Skip preamble/header rows before the first valid data row.
    if (!started) {
      if (!valid) return;
      started = true;
    }

    if (allEmpty) return;
    totalRows += 1;

    if (!valid) {
      const missing: string[] = [];
      if (!date) missing.push("DATA inválida ou vazia");
      if (!line) missing.push("LINHA inválida ou vazia");
      if (!direction) missing.push("SENTIDO deve ser IDA ou VOLTA");
      if (!car) missing.push("CARRO inválido ou vazio");
      if (!start) missing.push("PARTIDA inválida ou vazia");
      if (!end) missing.push("CHEGADA inválida ou vazia");
      const snippet = `DATA="${cellToString(get(IDX.date))}" | LINHA="${cellToString(get(IDX.line))}" | CARRO="${cellToString(get(IDX.car))}" | SENTIDO="${cellToString(get(IDX.direction))}" | PARTIDA="${cellToString(get(IDX.start))}" | CHEGADA="${cellToString(get(IDX.end))}"`;
      errors.push({ excelRow, reason: missing.join("; "), snippet });
      return;
    }

    records.push({
      excelRow,
      date,
      text: `${date} ${line} ${direction} N ${car} ${start} ${end} 00000 00000 00000`,
    });
  });

  return { totalRows, records, errors };
}

// Preview: quebras simples apenas para exibição na tela.
export const buildTxt = (records: ConvertedRow[]) => records.map((r) => r.text).join("\n");

// Arquivo final: CRLF (padrão Windows/sistemas legados) e quebra de linha ao final.
export const buildTxtFile = (records: ConvertedRow[]) =>
  records.length === 0 ? "" : records.map((r) => r.text).join("\r\n") + "\r\n";
