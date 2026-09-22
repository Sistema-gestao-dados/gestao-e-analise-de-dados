// Custo de mão de obra por serviço, seguindo o acordo coletivo do
// motorista (confirmado com o usuário em 11-14/09/2026):
//
//   valor_hora = salário mensal ÷ horas mensais de referência (210h)
//
//   Por serviço:
//     - horas normais = todas as horas trabalhadas (minutosTotal)
//     - horas extras   = o que passar do limite do tipo (7h DIR / 8h24 TU) → +50%
//     - horas noturnas = minutos do turno dentro de 22h-5h → +20%
//     - hora refeição  = valor FIXO por serviço/dia (não por hora
//       trabalhada, apesar do nome) — vale pra DIR e TU igual
//
//   IMPORTANTE (corrigido em 14/09/2026, confirmado batendo com o
//   InputBus): os encargos sociais incidem SÓ no salário das horas
//   normais — NÃO incidem sobre hora extra, noturno nem hora refeição,
//   que entram como valores "crus", somados por fora:
//
//   custo = valor_hora × horas_totais × (1 + %encargos)
//         + valor_hora × horas_extra × %he
//         + valor_hora × horas_noturnas × %noturno
//         + valor_hora_refeicao
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
  valorHoraRefeicao: number;
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
  valorHoraRefeicao: 0,
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
    valorHoraRefeicao: Number(data.valor_hora_refeicao ?? PADRAO.valorHoraRefeicao),
    noturnoInicioMin: Number(data.noturno_inicio_min ?? PADRAO.noturnoInicioMin),
    noturnoFimMin: Number(data.noturno_fim_min ?? PADRAO.noturnoFimMin),
    tuInicioMinimoMin: Number(data.tu_inicio_minimo_min ?? PADRAO.tuInicioMinimoMin),
    tuFimMaximoMin: Number(data.tu_fim_maximo_min ?? PADRAO.tuFimMaximoMin),
  };
}

export async function salvarParametrosCusto(p: ParametrosCusto): Promise<void> {
  // upsert em vez de update: garante que a linha id=1 sempre existe depois
  // de salvar, mesmo que por algum motivo ela não existisse antes (um
  // UPDATE simples, nesse caso, "funcionaria" sem erro mas não salvaria
  // nada — foi exatamente o bug do salário voltando a zero em outro local).
  const { error } = await supabase.from("parametros_custo").upsert({
    id: 1,
    salario_motorista_mensal: p.salarioMotoristaMensal,
    encargos_percentual: p.encargosPercentual,
    adicional_noturno_percentual: p.adicionalNoturnoPercentual,
    hora_extra_percentual: p.horaExtraPercentual,
    horas_mensais_referencia: p.horasMensaisReferencia,
    valor_hora_refeicao: p.valorHoraRefeicao,
    noturno_inicio_min: p.noturnoInicioMin,
    noturno_fim_min: p.noturnoFimMin,
    tu_inicio_minimo_min: p.tuInicioMinimoMin,
    tu_fim_maximo_min: p.tuFimMaximoMin,
  });
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
  // Só soma +1440 no fim quando ele REALMENTE cruza meia-noite (ex.: 22h→5h,
  // fim numericamente menor que início). Se alguém configurar os dois campos
  // invertidos ou uma janela do mesmo dia (fim >= início, ex.: 10h→14h por
  // engano), forçar sempre "fim = dia seguinte" desloca a janela toda um dia
  // inteiro e o adicional noturno passa a não bater com nenhum turno real.
  const cruzaMeiaNoite = p.noturnoFimMin <= p.noturnoInicioMin;
  let total = 0;
  for (const offset of [-1440, 0, 1440]) {
    const nInicio = p.noturnoInicioMin + offset;
    const nFim = (cruzaMeiaNoite ? p.noturnoFimMin + 1440 : p.noturnoFimMin) + offset;
    const s = Math.max(inicioMin, nInicio);
    const e = Math.min(fimMin, nFim);
    if (e > s) total += e - s;
  }
  return total;
}

/** Custo de mão de obra de UM serviço (JornadaServico). Encargos incidem
 * só no salário das horas normais — hora extra, noturno e hora refeição
 * entram como valores à parte, sem encargos (confirmado batendo com o
 * InputBus em 14/09/2026).
 *
 * IMPORTANTE: horas normais são LIMITADAS no teto do tipo de serviço (7h
 * DIR / 8h24 TU) — o que passa do teto NÃO entra no cálculo do salário
 * normal, só na hora extra. Antes disso estava contando a hora extra
 * duas vezes (uma dentro do "salário" inteiro sem limite, outra como
 * bônus) — corrigido depois de comparar com o InputBus e ver que a hora
 * extra deveria ser paga na taxa CHEIA de 150%, não um adicional de 50%
 * em cima de uma hora que já tinha sido contada no salário normal. */
export function custoServico(j: JornadaServico, p: ParametrosCusto): number {
  const vh = valorHora(p);
  if (vh <= 0 && p.valorHoraRefeicao <= 0) return 0;
  const horasNormais = Math.min(j.minutosTotal, j.limiteMin) / 60;
  const horasExtra = Math.max(0, j.minutosTotal - j.limiteMin) / 60;
  const minNoturnos = j.turnos.reduce((s, t) => s + minutosNoturnos(t.inicioMin, t.fimMin, p), 0);
  const horasNoturnas = minNoturnos / 60;
  const salarioComEncargos = vh * horasNormais * (1 + p.encargosPercentual / 100);
  const valorHoraExtra = vh * horasExtra * (1 + p.horaExtraPercentual / 100);
  const valorNoturno = vh * horasNoturnas * (p.adicionalNoturnoPercentual / 100);
  return salarioComEncargos + valorHoraExtra + valorNoturno + p.valorHoraRefeicao;
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
