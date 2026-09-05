// Parser do relatório "Gestão de Viagem" do Cittati (CSV ; separado), que já
// traz Previsto x Realizado por trecho. Fica independente da escala
// programada (tabela `viagens`) — é uma foto fechada de um período já
// encerrado. Ver conversa de 05/09/2026 pro desenho completo.

export type RealizadoRow = {
  empresa: string | null;
  linha: string;
  linha_raw: string | null;
  data: string; // yyyy-mm-dd
  numero: string | null;
  servico: string | null;
  turno: string | null;
  sentido: string | null; // I | V
  prefixo_raw: string | null;
  veiculo: string | null;
  motorista: string | null;
  terminal_inicial: string | null;
  terminal_final: string | null;
  prev_partida: string | null;
  real_partida: string | null;
  dif_partida: number | null;
  prev_chegada: string | null;
  real_chegada: string | null;
  dif_chegada: number | null;
  prev_tempo_viagem: number | null;
  real_tempo_viagem: number | null;
  dif_tempo_viagem: number | null;
  passageiros: number | null;
  motivo: string | null;
};

export type ParseResult = {
  rows: RealizadoRow[];
  errors: { line: number; reason: string }[];
  totalLinhas: number;
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
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === delim && !inQuotes) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const squash = (s: unknown) => norm(s).replace(/[^a-z0-9]/g, "");

/** "403M - Niterói - Trindade (via Porto Velho)" -> "403M" */
function extrairCodigoLinha(raw: string): string {
  const code = String(raw ?? "").split("-")[0].trim().toUpperCase();
  return code;
}

/** "152187 - RIBR" -> "152187" */
function extrairVeiculo(raw: string): string | null {
  const digits = String(raw ?? "").split("-")[0].replace(/\D/g, "").trim();
  return digits || null;
}

/** "01.1" -> { servico: "01", turno: "1" } — mesma regra do import FLITS/EasyBus. */
function parseServicoTurno(raw: string): { servico: string | null; turno: string | null } {
  const v = (raw ?? "").trim();
  if (!v) return { servico: null, turno: null };
  const [svc, turno] = v.split(".");
  return { servico: svc?.trim() || null, turno: turno?.trim() || null };
}

function parseSentido(raw: string): string | null {
  const n = norm(raw);
  if (n.startsWith("ida")) return "I";
  if (n.startsWith("volta")) return "V";
  return null;
}

/** "05/09/2026" ou "05/09/2026 04:30:00" -> "2026-09-05" */
function parseData(raw: string): string | null {
  const m = String(raw ?? "").match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${mm}-${dd}`;
}

/** Extrai só HH:MM de "05/09/2026 04:30:00" ou "04:33". Vazio -> null. */
function parseHora(raw: string): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = v.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function parseInt10(raw: string): number | null {
  const v = String(raw ?? "").trim();
  if (v === "") return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// Colunas esperadas (título flexível, ignora acento/maiúscula), na ORDEM em
// que aparecem repetidas no arquivo real do Cittati ("Gestão de Viagem").
const HEADERS = [
  "empresa", "linha", "data", "numero", "atividade", "posicao", "sentido", "atendimento",
  "prefixo", "motorista", "terminalinicial", "prev", "real", "dif", "intervalo", "terminalfinal",
  "prev", "real", "dif", "prev", "real", "dif", "passageiros", "motivo", "passageiros",
  "prev", "real", "dif",
];

export function parseRealizadoCsv(text: string): ParseResult {
  const errors: ParseResult["errors"] = [];
  const rows: RealizadoRow[] = [];
  let content = text;
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { rows, errors, totalLinhas: 0 };

  const delim = detectDelimiter(lines[0]);
  const rawHeader = splitLine(lines[0], delim);
  const header = rawHeader.map(squash);

  // Confirma que o cabeçalho bate com o esperado (por título, tolerando
  // pequenas variações de nome, já que colunas repetidas como "Prev"/"Real"
  // aparecem várias vezes e só a posição diferencia o significado).
  // Localiza uma coluna pelo nome (squashed). Aceita tanto cabeçalho com
  // sufixo numérico já pronto (ex.: "Prev2", como vem no CSV exportado do
  // Cittati) quanto cabeçalho com nomes repetidos de verdade sem sufixo
  // (ex.: a planilha XLSX bruta, onde "Prev" aparece 4 vezes) — nesse caso
  // usa a Nª ocorrência do nome base.
  const idx = (nomeComSufixo: string, nomeBase: string, occurrence: number) => {
    const direto = header.indexOf(nomeComSufixo);
    if (direto !== -1) return direto;
    let count = 0;
    for (let i = 0; i < header.length; i++) {
      if (header[i] === nomeBase) {
        if (count === occurrence) return i;
        count++;
      }
    }
    return -1;
  };

  const iEmpresa = header.indexOf("empresa");
  const iLinha = header.indexOf("linha");
  const iData = header.indexOf("data");
  const iNumero = header.indexOf("numero");
  const iPosicao = header.indexOf("posicao");
  const iSentido = header.indexOf("sentido");
  const iPrefixo = header.indexOf("prefixo");
  const iMotorista = header.indexOf("motorista");
  const iTermInicial = header.indexOf("terminalinicial");
  const iPrev1 = idx("prev", "prev", 0);
  const iReal1 = idx("real", "real", 0);
  const iDif1 = idx("dif", "dif", 0);
  const iTermFinal = header.indexOf("terminalfinal");
  const iPrev2 = idx("prev2", "prev", 1);
  const iReal2 = idx("real2", "real", 1);
  const iDif2 = idx("dif2", "dif", 1);
  const iPrev3 = idx("prev3", "prev", 2);
  const iReal3 = idx("real3", "real", 2);
  const iDif3 = idx("dif3", "dif", 2);
  const iPassageiros = header.indexOf("passageiros");
  const iMotivo = header.indexOf("motivo");

  if (iLinha === -1 || iData === -1 || iSentido === -1 || iPrev1 === -1 || iPrev2 === -1) {
    errors.push({
      line: 1,
      reason: "Não foi possível identificar as colunas esperadas (Linha, Data, Sentido, Prev/Real de partida e chegada). Confirme se o arquivo é o relatório 'Gestão de Viagem' do Cittati, exportado em CSV.",
    });
    return { rows, errors, totalLinhas: 0 };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i], delim);
    const data = parseData(cols[iData] ?? "");
    const linhaRaw = cols[iLinha] ?? "";
    const linha = extrairCodigoLinha(linhaRaw);
    const sentido = parseSentido(cols[iSentido] ?? "");

    if (!data || !linha || !sentido) {
      errors.push({
        line: i + 1,
        reason: `Linha/Data/Sentido inválidos ou vazios (LINHA="${cols[iLinha] ?? ""}", DATA="${cols[iData] ?? ""}", SENTIDO="${cols[iSentido] ?? ""}").`,
      });
      continue;
    }

    const { servico, turno } = parseServicoTurno(cols[iPosicao] ?? "");

    rows.push({
      empresa: iEmpresa !== -1 ? (cols[iEmpresa]?.trim() || null) : null,
      linha,
      linha_raw: linhaRaw.trim() || null,
      data,
      numero: iNumero !== -1 ? (cols[iNumero]?.trim() || null) : null,
      servico,
      turno,
      sentido,
      prefixo_raw: iPrefixo !== -1 ? (cols[iPrefixo]?.trim() || null) : null,
      veiculo: iPrefixo !== -1 ? extrairVeiculo(cols[iPrefixo] ?? "") : null,
      motorista: iMotorista !== -1 ? (cols[iMotorista]?.trim() || null) : null,
      terminal_inicial: iTermInicial !== -1 ? (cols[iTermInicial]?.trim() || null) : null,
      terminal_final: iTermFinal !== -1 ? (cols[iTermFinal]?.trim() || null) : null,
      prev_partida: parseHora(cols[iPrev1] ?? ""),
      real_partida: parseHora(cols[iReal1] ?? ""),
      dif_partida: iDif1 !== -1 ? parseInt10(cols[iDif1] ?? "") : null,
      prev_chegada: parseHora(cols[iPrev2] ?? ""),
      real_chegada: parseHora(cols[iReal2] ?? ""),
      dif_chegada: iDif2 !== -1 ? parseInt10(cols[iDif2] ?? "") : null,
      prev_tempo_viagem: iPrev3 !== -1 ? parseInt10(cols[iPrev3] ?? "") : null,
      real_tempo_viagem: iReal3 !== -1 ? parseInt10(cols[iReal3] ?? "") : null,
      dif_tempo_viagem: iDif3 !== -1 ? parseInt10(cols[iDif3] ?? "") : null,
      passageiros: iPassageiros !== -1 ? parseInt10(cols[iPassageiros] ?? "") : null,
      motivo: iMotivo !== -1 ? (cols[iMotivo]?.trim() || null) : null,
    });
  }

  return { rows, errors, totalLinhas: lines.length - 1 };
}

// ---- Classificação de cada viagem, pro relatório visual ----

export type StatusViagem = "perdida" | "incompleta" | "atrasada" | "adiantada" | "no_horario";

/** Tolerância padrão: até 5 min de diferença (pra mais ou pra menos) conta
 * como "no horário". Ajustável pelo relatório. */
export function classificar(r: RealizadoRow, toleranciaMin = 5): StatusViagem {
  if (!r.real_partida) return "perdida";
  if (!r.real_chegada) return "incompleta";
  const dif = r.dif_partida ?? 0;
  if (dif > toleranciaMin) return "atrasada";
  if (dif < -toleranciaMin) return "adiantada";
  return "no_horario";
}

export const STATUS_LABEL: Record<StatusViagem, string> = {
  perdida: "Perdida",
  incompleta: "Incompleta",
  atrasada: "Atrasada",
  adiantada: "Adiantada",
  no_horario: "No horário",
};

export const STATUS_COLOR: Record<StatusViagem, string> = {
  perdida: "#dc2626",
  incompleta: "#ea580c",
  atrasada: "#f59e0b",
  adiantada: "#3b82f6",
  no_horario: "#16a34a",
};
