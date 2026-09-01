// Cálculo de jornada de trabalho por serviço/turno.
//
// REGRAS (definitivas):
// - Início da jornada do turno = 1ª partida do turno − antecipação (min)
// - Fim   da jornada do turno = última chegada do turno + prestação de contas (min)
// - Jornada do turno = fim − início (em minutos)
// - DIR: cada turno é uma jornada separada (motorista distinto por turno,
//   mesmo com rendição de veículo).
// - TU : jornada = T1 + T2 do MESMO motorista (soma dos minutos de cada
//   turno; intrajornada NÃO conta).
//
// LIMITES:
// - DIR: jornada padrão 7h = 420 min
// - TU : jornada padrão 8h24 = 504 min
//
// Chave de serviço: versao||tipo||servico (isola DIR#N de TU#N).

import type { Linha } from "@/lib/data";
import type { ViagemLite, ServiceUnit } from "@/lib/resumo";

export const LIMITE_DIR_MIN = 420;    // 7h — motorista DIR
export const LIMITE_TU_MIN = 504;     // 8h24 — motorista TU
export const ALERTA_MIN = 9 * 60;     // 9h — atenção
export const CRITICO_MIN = 10 * 60;   // 10h — crítico

export function limiteJornada(tipo: string): number {
  return (tipo ?? "").toUpperCase() === "TU" ? LIMITE_TU_MIN : LIMITE_DIR_MIN;
}

// compat legacy import
export const HE_LIMITE_MIN = LIMITE_DIR_MIN;

export type TurnoJornada = {
  turno: "1" | "2" | "3";
  inicioMin: number;
  fimMin: number;
  minutos: number;
  primeiraPartida: string;
  ultimaChegada: string;
  antecipacao: number;
  prestacao: number;
};

export type JornadaServico = {
  versao: string;
  linha: string;
  tipoServico: "DIR" | "TU" | string;
  servico: string;
  vehicleKey: string;
  bucket: ServiceUnit["bucket"];
  turnos: TurnoJornada[];
  minutosTotal: number;
  limiteMin: number;
  horasExtras: number;
  acimaDe7h: boolean;
  acimaDe9h: boolean;
  incompleto: boolean;
  semCadastroLinha: boolean;
};

function parseHHMM(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function fmtHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function fmtDur(min: number): string {
  const s = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  return `${s}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

function antecPrestOf(l: Linha | undefined, turno: "1" | "2" | "3"): { antec: number; prest: number } {
  if (!l) return { antec: 0, prest: 0 };
  if (turno === "1") return { antec: Number(l.antec_t1 ?? 0), prest: Number(l.prest_t1 ?? 0) };
  if (turno === "2") return { antec: Number(l.antec_t2 ?? 0), prest: Number(l.prest_t2 ?? 0) };
  return { antec: Number(l.antec_t3 ?? 0), prest: Number(l.prest_t3 ?? 0) };
}

/**
 * Ajusta os horários de partida/chegada de um conjunto de viagens do MESMO
 * turno para tratar corretamente cruzamento de meia-noite.
 *
 * Estratégia (à prova de ordem dos dados):
 *  1. Ordena as viagens por partida (0..1439).
 *  2. Encontra o maior "gap" entre partidas consecutivas (circular).
 *  3. Se o maior gap > 4h no meio, o turno "começa" DEPOIS do gap. Todas as
 *     viagens ANTES do gap acontecem no DIA SEGUINTE (+1440). Assim uma
 *     jornada 15:00→02:00 é reconhecida como contínua e não como 23h.
 *  4. Se todas as partidas cabem em uma janela < 12h sem gaps grandes, não
 *     há cruzamento e não precisa ajustar.
 */
function ajustarTurno(viagens: ViagemLite[]): { partidas: number[]; chegadas: number[] } {
  const pares: { p: number; c: number }[] = [];
  for (const v of viagens) {
    const p = parseHHMM(v.partida);
    const c = parseHHMM(v.chegada);
    if (p == null || c == null) continue;
    // chegada da viagem individual pode passar da meia-noite
    let cAdj = c;
    if (cAdj < p) cAdj += 1440;
    pares.push({ p, c: cAdj });
  }
  if (!pares.length) return { partidas: [], chegadas: [] };

  // Ordena por partida
  const sorted = [...pares].sort((a, b) => a.p - b.p);

  // Se o intervalo total das partidas é pequeno (<12h), sem ajuste
  const min = sorted[0].p;
  const max = sorted[sorted.length - 1].p;
  if (max - min <= 12 * 60) {
    return {
      partidas: sorted.map((x) => x.p),
      chegadas: sorted.map((x) => x.c),
    };
  }

  // Procura o maior gap entre partidas consecutivas
  let gapIdx = -1;
  let gapSize = 0;
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].p - sorted[i - 1].p;
    if (g > gapSize) { gapSize = g; gapIdx = i; }
  }

  if (gapSize < 4 * 60 || gapIdx < 0) {
    return {
      partidas: sorted.map((x) => x.p),
      chegadas: sorted.map((x) => x.c),
    };
  }

  // Viagens ANTES do gap (índices 0..gapIdx-1) rodam no dia SEGUINTE (+1440);
  // viagens DEPOIS do gap (gapIdx..) rodam no dia atual.
  const partidas: number[] = [];
  const chegadas: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const off = i < gapIdx ? 1440 : 0;
    partidas.push(sorted[i].p + off);
    chegadas.push(sorted[i].c + off);
  }
  return { partidas, chegadas };
}

/**
 * Constrói as jornadas por (versao+tipo+servico). Para TU soma T1+T2.
 */
export function buildJornadas(
  viagens: ViagemLite[],
  linhas: Linha[],
): JornadaServico[] {
  const linhaMap = new Map<string, Linha>();
  linhas.forEach((l) => linhaMap.set(l.linha, l));

  type Group = {
    versao: string; tipo: string; servico: string; viagens: ViagemLite[];
  };
  const groups = new Map<string, Group>();
  for (const v of viagens) {
    const tipo = (v.tipo_servico ?? "").toUpperCase();
    if (!tipo || !v.servico || !v.versao_programacao) continue;
    if (tipo !== "DIR" && tipo !== "TU") continue;
    const k = `${v.versao_programacao}||${v.tipo_operacao ?? ""}||${tipo}||${v.servico}`;
    if (!groups.has(k)) groups.set(k, { versao: v.versao_programacao, tipo, servico: v.servico, viagens: [] });
    groups.get(k)!.viagens.push(v);
  }

  const out: JornadaServico[] = [];

  for (const g of groups.values()) {
    const cnt = new Map<string, number>();
    for (const v of g.viagens) cnt.set(v.linha, (cnt.get(v.linha) ?? 0) + 1);
    let linhaDom = "—", bestC = -1;
    for (const [l, c] of cnt) if (c > bestC) { linhaDom = l; bestC = c; }
    const linhaCad = linhaMap.get(linhaDom);
    const semCadastroLinha = !linhaCad;
    const diaTipo = g.viagens[0]?.tipo_operacao ?? "";
    const vehicleKey = `${g.versao}||${diaTipo}||${g.servico}`;

    const porTurno = new Map<string, ViagemLite[]>();
    for (const v of g.viagens) {
      const t = (v.turno ?? "").trim();
      if (t !== "1" && t !== "2" && t !== "3") continue;
      if (!porTurno.has(t)) porTurno.set(t, []);
      porTurno.get(t)!.push(v);
    }

    const turnos: TurnoJornada[] = [];
    for (const t of ["1", "2", "3"] as const) {
      const arr = porTurno.get(t);
      if (!arr || !arr.length) continue;

      const { partidas, chegadas } = ajustarTurno(arr);
      if (!partidas.length || !chegadas.length) continue;

      const primeira = Math.min(...partidas);
      const ultima = Math.max(...chegadas);
      const { antec, prest } = antecPrestOf(linhaCad, t);
      const inicio = primeira - antec;
      const fim = ultima + prest;
      const minutos = fim - inicio;
      // proteção final: jornada implausível (>20h) indica dados inconsistentes.
      if (minutos <= 0 || minutos > 20 * 60) continue;
      turnos.push({
        turno: t, inicioMin: inicio, fimMin: fim, minutos,
        primeiraPartida: fmtHHMM(primeira), ultimaChegada: fmtHHMM(ultima),
        antecipacao: antec, prestacao: prest,
      });
    }
    if (!turnos.length) continue;

    if (g.tipo === "TU") {
      const t12 = turnos.filter((t) => t.turno === "1" || t.turno === "2");
      if (!t12.length) continue;
      const incompleto = !t12.some((t) => t.turno === "1") || !t12.some((t) => t.turno === "2");
      const minutosTotal = t12.reduce((a, t) => a + t.minutos, 0);
      const lim = LIMITE_TU_MIN;
      out.push({
        versao: g.versao, linha: linhaDom, tipoServico: "TU", servico: g.servico,
        vehicleKey, bucket: "TU", turnos: t12,
        minutosTotal, limiteMin: lim,
        horasExtras: Math.max(0, minutosTotal - lim),
        acimaDe7h: minutosTotal > ALERTA_MIN,
        acimaDe9h: minutosTotal > CRITICO_MIN,
        incompleto,
        semCadastroLinha,
      });
    } else {
      for (const tj of turnos) {
        const bucket = tj.turno === "1" ? "DIR_T1" : tj.turno === "2" ? "DIR_T2" : "APROV";
        const lim = LIMITE_DIR_MIN;
        out.push({
          versao: g.versao, linha: linhaDom, tipoServico: "DIR", servico: g.servico,
          vehicleKey, bucket, turnos: [tj],
          minutosTotal: tj.minutos, limiteMin: lim,
          horasExtras: Math.max(0, tj.minutos - lim),
          acimaDe7h: tj.minutos > ALERTA_MIN,
          acimaDe9h: tj.minutos > CRITICO_MIN,
          incompleto: false,
          semCadastroLinha,
        });
      }
    }
  }

  return out.sort((a, b) => b.minutosTotal - a.minutosTotal);
}

export function jornadaTotais(js: JornadaServico[]) {
  const validas = js.filter((j) => !j.incompleto);
  return {
    totalJornadas: validas.length,
    minutosTotal: validas.reduce((s, j) => s + j.minutosTotal, 0),
    horasExtrasTotal: validas.reduce((s, j) => s + j.horasExtras, 0),
    acimaDe7h: validas.filter((j) => j.acimaDe7h && !j.acimaDe9h).length,
    acimaDe9h: validas.filter((j) => j.acimaDe9h).length,
    incompletas: js.length - validas.length,
    semCadastroLinha: js.filter((j) => j.semCadastroLinha).length,
  };
}
