// Resolve EMPRESA, GRUPO (ex-"Ordem") e UNIDADE de uma viagem quando a
// mesma linha é operada por mais de uma empresa (ex.: linha "07" = Icaraí +
// Grupo Maua + Unidade Icaraí em alguns trechos, Tanguá + Grupo Rio Ita +
// Unidade Expresso Tanguá em outros). A regra é a mesma pros três campos:
// se a linha tiver exceções cadastradas em `linha_empresa_estacao`, decide
// pela origem OU destino da viagem batendo com uma estação cadastrada; se
// não bater com nenhuma exceção (ou o campo daquela estação estiver em
// branco), cai no cadastro normal da linha (`linhas`).

import type { Linha, LinhaEmpresaEstacao } from "./data";

type Override = { empresa: string; grupo: string | null; unidade: string | null };
export type EmpresaOverrideMap = Map<string, Map<string, Override>>; // linha -> (estacao -> {empresa, grupo, unidade})

export function buildEmpresaOverrideMap(rows: LinhaEmpresaEstacao[]): EmpresaOverrideMap {
  const m: EmpresaOverrideMap = new Map();
  for (const r of rows) {
    const porEstacao = m.get(r.linha) ?? new Map<string, Override>();
    porEstacao.set(r.estacao, { empresa: r.empresa, grupo: r.grupo ?? null, unidade: r.unidade ?? null });
    m.set(r.linha, porEstacao);
  }
  return m;
}

function findOverride(
  v: { linha: string; origem?: string | null; destino?: string | null },
  overrideMap: EmpresaOverrideMap,
): Override | null {
  const porEstacao = overrideMap.get(v.linha);
  if (!porEstacao) return null;
  if (v.origem && porEstacao.has(v.origem)) return porEstacao.get(v.origem)!;
  if (v.destino && porEstacao.has(v.destino)) return porEstacao.get(v.destino)!;
  return null;
}

/** Resolve a empresa de UMA viagem. Prioriza a exceção por estação; cai pro
 * cadastro normal da linha se não houver exceção ou não bater nenhuma. */
export function resolveEmpresaViagem(
  v: { linha: string; origem?: string | null; destino?: string | null },
  linhaMap: Map<string, Linha>,
  overrideMap: EmpresaOverrideMap,
): string | null {
  const o = findOverride(v, overrideMap);
  if (o?.empresa) return o.empresa;
  return linhaMap.get(v.linha)?.empresa ?? null;
}

/** Resolve o Grupo (ex-"Ordem") de UMA viagem. Mesma prioridade: exceção
 * por estação (se o campo grupo dela estiver preenchido) > cadastro normal
 * da linha. */
export function resolveGrupoViagem(
  v: { linha: string; origem?: string | null; destino?: string | null },
  linhaMap: Map<string, Linha>,
  overrideMap: EmpresaOverrideMap,
): string | null {
  const o = findOverride(v, overrideMap);
  if (o?.grupo) return o.grupo;
  return linhaMap.get(v.linha)?.ordem ?? null;
}

/** Resolve a Unidade de UMA viagem. Mesma prioridade: exceção por estação
 * (se o campo unidade dela estiver preenchido) > cadastro normal da linha. */
export function resolveUnidadeViagem(
  v: { linha: string; origem?: string | null; destino?: string | null },
  linhaMap: Map<string, Linha>,
  overrideMap: EmpresaOverrideMap,
): string | null {
  const o = findOverride(v, overrideMap);
  if (o?.unidade) return o.unidade;
  return linhaMap.get(v.linha)?.unidade ?? null;
}

type Viagem = { linha: string; origem?: string | null; destino?: string | null; versao_programacao?: string | null; tipo_operacao?: string | null; servico?: string | null };

function buildPorServicoGenerico(
  viagens: Viagem[],
  resolver: (v: Viagem, linhaMap: Map<string, Linha>, overrideMap: EmpresaOverrideMap) => string | null,
  linhaMap: Map<string, Linha>,
  overrideMap: EmpresaOverrideMap,
): Map<string, string> {
  const tally = new Map<string, Map<string, number>>();
  for (const v of viagens) {
    const vehicleKey = `${v.versao_programacao ?? ""}||${v.tipo_operacao ?? ""}||${v.servico ?? ""}`;
    const val = resolver(v, linhaMap, overrideMap);
    if (!val) continue;
    const m = tally.get(vehicleKey) ?? new Map<string, number>();
    m.set(val, (m.get(val) ?? 0) + 1);
    tally.set(vehicleKey, m);
  }
  const out = new Map<string, string>();
  for (const [key, m] of tally) {
    let best: string | null = null, bestN = -1;
    for (const [val, n] of m) if (n > bestN) { best = val; bestN = n; }
    if (best) out.set(key, best);
  }
  return out;
}

/** Resolve o Grupo por SERVIÇO (vehicleKey = versao||tipo_operacao||servico),
 * pra usar em resumos que agregam por serviço/frota (jornada, dashboard).
 * Cada serviço deve pertencer inteiro a uma empresa só (o carro roda pra
 * uma empresa só no dia) — usa a maioria das viagens do serviço. */
export function buildGrupoPorServico(
  viagens: Viagem[],
  linhaMap: Map<string, Linha>,
  overrideMap: EmpresaOverrideMap,
): Map<string, string> {
  return buildPorServicoGenerico(viagens, resolveGrupoViagem, linhaMap, overrideMap);
}

/** Mesma ideia do buildGrupoPorServico, mas pra Empresa. */
export function buildEmpresaPorServico(
  viagens: Viagem[],
  linhaMap: Map<string, Linha>,
  overrideMap: EmpresaOverrideMap,
): Map<string, string> {
  return buildPorServicoGenerico(viagens, resolveEmpresaViagem, linhaMap, overrideMap);
}

/** Mesma ideia do buildGrupoPorServico, mas pra Unidade. */
export function buildUnidadePorServico(
  viagens: Viagem[],
  linhaMap: Map<string, Linha>,
  overrideMap: EmpresaOverrideMap,
): Map<string, string> {
  return buildPorServicoGenerico(viagens, resolveUnidadeViagem, linhaMap, overrideMap);
}
