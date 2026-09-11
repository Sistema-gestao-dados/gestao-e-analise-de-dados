// Custo de mão de obra por serviço, seguindo o acordo coletivo do
// motorista (confirmado com o usuário em 11/09/2026):
//
//   valor_hora = salário mensal ÷ horas mensais de referência (210h)
//
//   Por serviço:
//     - horas normais = até o limite do tipo (7h DIR / 8h24 TU)
//     - horas extras   = o que passar do limite  → +50%
//     - horas noturnas = minutos do turno dentro de 22h-5h → +20%
//     (os dois adicionais SOMAM quando coincidem, não se substituem)
//
//   custo = valor_hora × [horas totais + horas_extra×%he + horas_noturnas×%noturno]
//           × (1 + %encargos)
//
// TU só pode começar não antes de 04:00 e terminar não depois de 21:00
// (parâmetro configurável, usado no alerta da tela Intra Jornada).

import { supabase } from "@/integrations/supabase/client";
import type { JornadaServico } from "@/lib/jornada";

export type ParametrosCusto = {
  salarioMotoristaMensal: number;
  encargosPercentual: number;
  adicionalNoturnoPercentual: number;
  horaExtraPercentual: number;
  horasMensaisReferencia: number;
  noturnoInicioMin: number; // minutos desde 00:00 (ex.: 22:00 = 1320)
  noturnoFimMin: number;    // minutos desde 00:00 (ex.: 05:00 = 300)
  tuInicioMinimoMin: number; // 04:00 = 240
  tuFimMaximoMin: number;    // 21:00 = 1260
};

const PADRAO: ParametrosCusto = {
  salarioMotoristaMensal: 0,
  encargosPercentual: 46,
  adicionalNoturnoPercentual: 20,
  horaExtraPercentual: 50,
  horasMensaisReferencia: 210,
  noturnoInicioMin: 22 * 60,
  noturnoFimMin: 5 * 60,
  tuInicioMinimoMin: 4 * 60,
  tuFimMaximoMin: 21 * 60,
};

export async function fetchParametrosCusto(): Promise<ParametrosCusto> {
  const { data, error } = await supabase.from("parametros_custo").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) return PADRAO;
  return {
    salarioMotoristaMensal: Number(data.salario_motorista_mensal ?? 0),
    encargosPercentual: Number(data.encargos_percentual ?? PADRAO.encargosPercentual),
    adicionalNoturnoPercentual: Number(data.adicional_noturno_percentual ?? PADRAO.adicionalNoturnoPercentual),
    horaExtraPercentual: Number(data.hora_extra_percentual ?? PADRAO.horaExtraPercentual),
    horasMensaisReferencia: Number(data.horas_mensais_referencia ?? PADRAO.horasMensaisReferencia),
    noturnoInicioMin: Number(data.noturno_inicio_min ?? PADRAO.noturnoInicioMin),
    noturnoFimMin: Number(data.noturno_fim_min ?? PADRAO.noturnoFimMin),
    tuInicioMinimoMin: Number(data.tu_inicio_minimo_min ?? PADRAO.tuInicioMinimoMin),
    tuFimMaximoMin: Number(data.tu_fim_maximo_min ?? PADRAO.tuFimMaximoMin),
  };
}

export async function salvarParametrosCusto(p: ParametrosCusto): Promise<void> {
  const { error } = await supabase.from("parametros_custo").update({
    salario_motorista_mensal: p.salarioMotoristaMensal,
    encargos_percentual: p.encargosPercentual,
    adicional_noturno_percentual: p.adicionalNoturnoPercentual,
    hora_extra_percentual: p.horaExtraPercentual,
    horas_mensais_referencia: p.horasMensaisReferencia,
    noturno_inicio_min: p.noturnoInicioMin,
    noturno_fim_min: p.noturnoFimMin,
    tu_inicio_minimo_min: p.tuInicioMinimoMin,
    tu_fim_maximo_min: p.tuFimMaximoMin,
  }).eq("id", 1);
  if (error) throw error;
}

export function valorHora(p: ParametrosCusto): number {
  return p.horasMensaisReferencia > 0 ? p.salarioMotoristaMensal / p.horasMensaisReferencia : 0;
}

/** Minutos de um intervalo [inicioMin, fimMin) que caem dentro da janela
 * noturna (ex.: 22h-5h) — testa a janela no dia anterior/mesmo dia/dia
 * seguinte pra cobrir corretamente virada de meia-noite, já que os
 * horários de turno podem vir ajustados com +1440 (ver ajustarTurno em
 * jornada.ts). */
export function minutosNoturnos(inicioMin: number, fimMin: number, p: ParametrosCusto): number {
  let total = 0;
  for (const offset of [-1440, 0, 1440]) {
    const nInicio = p.noturnoInicioMin + offset;
    const nFim = p.noturnoFimMin + 1440 + offset; // fim (05:00) é sempre no "dia seguinte" ao início (22:00)
    const s = Math.max(inicioMin, nInicio);
    const e = Math.min(fimMin, nFim);
    if (e > s) total += e - s;
  }
  return total;
}

/** Custo de mão de obra de UM serviço (JornadaServico), já com hora extra,
 * adicional noturno e encargos aplicados. */
export function custoServico(j: JornadaServico, p: ParametrosCusto): number {
  const vh = valorHora(p);
  if (vh <= 0) return 0;
  const horasTotais = j.minutosTotal / 60;
  const horasExtra = Math.max(0, j.minutosTotal - j.limiteMin) / 60;
  const minNoturnos = j.turnos.reduce((s, t) => s + minutosNoturnos(t.inicioMin, t.fimMin, p), 0);
  const horasNoturnas = minNoturnos / 60;
  const base = horasTotais + horasExtra * (p.horaExtraPercentual / 100) + horasNoturnas * (p.adicionalNoturnoPercentual / 100);
  return vh * base * (1 + p.encargosPercentual / 100);
}

/** Verifica se o serviço TU respeita a janela permitida (ex.: não começar
 * antes de 04:00 nem terminar depois de 21:00). Só se aplica a TU — DIR
 * retorna sempre false (a regra é específica do regime de TU). Os minutos
 * de início/fim de cada turno já vêm ajustados pra virada de meia-noite
 * (ver ajustarTurno em jornada.ts): um TU dentro da janela normal (04h-21h)
 * nunca tem esse ajuste aplicado, então a comparação direta já funciona. */
export function tuForaDaJanela(j: JornadaServico, p: ParametrosCusto): boolean {
  if (j.tipoServico !== "TU" || !j.turnos.length) return false;
  const inicio = Math.min(...j.turnos.map((t) => t.inicioMin));
  const fim = Math.max(...j.turnos.map((t) => t.fimMin));
  return inicio < p.tuInicioMinimoMin || fim > p.tuFimMaximoMin;
}

export function fmtMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtPercent(v: number): string {
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}
