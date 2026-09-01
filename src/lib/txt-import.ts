// Parser para arquivos TXT (GPS Cittati) com separador ";"
// Layout observado (1-indexado):
// 1=Linha, 2=Tipo Operação (1/2/3), 3=Versão Programação,
// 4=(vazio), 5=Serviço combinado (ex.: "TU07.1" ou "07.1"),
// 6=Origem, 7=Destino, 8=(ignorado / nº viagem),
// 9=Tipo Movimento (5/10/3), 10=Categoria (0/1),
// 11=Sentido (I/V), 12=Partida (HHMM), 13=Chegada (HHMM)

export type ViagemParsed = {
  linha: string;
  tipo_operacao: string | null;
  versao_programacao: string | null;
  tipo_servico: string | null;
  servico: string | null;
  turno: string | null;
  origem: string | null;
  destino: string | null;
  tipo_movimento: string | null;
  categoria_movimento: string | null;
  sentido: string | null;
  partida: string | null;
  chegada: string | null;
  tempo_viagem: string | null;
};

const TIPO_OP: Record<string, string> = { "1": "Dias Úteis", "2": "Sábado", "3": "Domingo" };
const TIPO_MOV: Record<string, string> = { "5": "Soltura", "10": "Comercial", "3": "Recolha" };
const CATEGORIA: Record<string, string> = { "0": "Deslocamento", "1": "Viagem" };
const SENTIDO: Record<string, string> = { I: "Ida", V: "Volta" };

function fmtHora(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\D/g, "");
  if (s.length < 3) return null;
  const padded = s.padStart(4, "0").slice(0, 4);
  const h = padded.slice(0, 2);
  const m = padded.slice(2, 4);
  const hi = Number(h), mi = Number(m);
  if (isNaN(hi) || isNaN(mi) || hi > 23 || mi > 59) return null;
  return `${h}:${m}`;
}

function tempoViagem(partida: string | null, chegada: string | null): string | null {
  if (!partida || !chegada) return null;
  const [ph, pm] = partida.split(":").map(Number);
  const [ch, cm] = chegada.split(":").map(Number);
  let diff = (ch * 60 + cm) - (ph * 60 + pm);
  if (diff < 0) diff += 24 * 60; // virada de dia
  const hh = Math.floor(diff / 60).toString().padStart(2, "0");
  const mm = (diff % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseServico(raw: string): { tipo_servico: string; servico: string | null; turno: string | null } {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v) return { tipo_servico: "DIR", servico: null, turno: null };
  const hasTU = v.startsWith("TU");
  const body = hasTU ? v.slice(2) : v;
  const [svc, turno] = body.split(".");
  return {
    tipo_servico: hasTU ? "TU" : "DIR",
    servico: svc?.trim() || null,
    turno: turno?.trim() || null,
  };
}

export type ParseResult = {
  rows: ViagemParsed[];
  errors: { line: number; reason: string }[];
};

export function parseTxt(content: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const rows: ViagemParsed[] = [];
  const errors: { line: number; reason: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const c = raw.split(";");
    try {
      const linha = (c[0] ?? "").trim();
      if (!linha) { errors.push({ line: i + 1, reason: "Linha vazia (coluna 1)" }); continue; }

      const tipo_operacao = TIPO_OP[(c[1] ?? "").trim()] ?? null;
      const versao_programacao = (c[2] ?? "").trim() || null;
      const svc = parseServico(c[4] ?? "");
      const origem = (c[5] ?? "").trim() || null;
      const destino = (c[6] ?? "").trim() || null;
      const tipo_movimento = TIPO_MOV[(c[8] ?? "").trim()] ?? null;
      const categoria_movimento = CATEGORIA[(c[9] ?? "").trim()] ?? null;
      const sentido = SENTIDO[(c[10] ?? "").trim().toUpperCase()] ?? null;
      const partida = fmtHora(c[11]);
      const chegada = fmtHora(c[12]);
      const tempo_viagem = tempoViagem(partida, chegada);

      rows.push({
        linha,
        tipo_operacao,
        versao_programacao,
        tipo_servico: svc.tipo_servico,
        servico: svc.servico,
        turno: svc.turno,
        origem,
        destino,
        tipo_movimento,
        categoria_movimento,
        sentido,
        partida,
        chegada,
        tempo_viagem,
      });
    } catch (e: any) {
      errors.push({ line: i + 1, reason: e?.message ?? "Erro desconhecido" });
    }
  }
  return { rows, errors };
}
