// Resolve EMPRESA e GRUPO (campo "Grupo", ex-"Ordem") de uma viagem quando a
// mesma linha é operada por mais de uma empresa/grupo (ex.: linha "07" =
// Icaraí + Grupo Maua em alguns trechos, Tanguá + Grupo Rio Ita em outros).
// A regra é a mesma pros dois campos: se a linha tiver exceções cadastradas
// em `linha_empresa_estacao`, decide pela origem OU destino da viagem
// batendo com uma estação cadastrada; se não bater com nenhuma exceção (ou
// a linha não tiver exceção nenhuma, ou o campo grupo daquela estação
// estiver em branco), cai no cadastro normal da linha (`linhas`).

import type { Linha, LinhaEmpresaEstacao } from "./data";

type Override = { empresa: string; grupo: string | null };
export type EmpresaOverrideMap = Map<string, Map<string, Override>>; // linha -> (estacao -> {empresa, grupo})

export function buildEmpresaOverrideMap(rows: LinhaEmpresaEstacao[]): EmpresaOverrideMap {
  const m: EmpresaOverrideMap = new Map();
  for (const r of rows) {
    const porEstacao = m.get(r.linha) ?? new Map<string, Override>();
    porEstacao.set(r.estacao, { empresa: r.empresa, grupo: r.grupo ?? null });
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

/** Resolve a empresa por SERVIÇO (vehicleKey = versao||tipo_operacao||servico),
 * pra usar em resumos que agregam por serviço/frota. Cada serviço deve
 * pertencer inteiro a uma empresa só (o carro roda pra uma empresa só no
 * dia) — usa a maioria das viagens do serviço, com desempate pela primeira. */
export function buildEmpresaPorServico(
  viagens: { linha: string; origem?: string | null; destino?: string | null; versao_programacao?: string | null; tipo_operacao?: string | null; servico?: string | null }[],
  linhaMap: Map<string, Linha>,
  overrideMap: EmpresaOverrideMap,
): Map<string, string> {
  const tally = new Map<string, Map<string, number>>();
  for (const v of viagens) {
    const vehicleKey = `${v.versao_programacao ?? ""}||${v.tipo_operacao ?? ""}||${v.servico ?? ""}`;
    const empresa = resolveEmpresaViagem(v, linhaMap, overrideMap);
    if (!empresa) continue;
    const m = tally.get(vehicleKey) ?? new Map<string, number>();
    m.set(empresa, (m.get(empresa) ?? 0) + 1);
    tally.set(vehicleKey, m);
  }
  const out = new Map<string, string>();
  for (const [key, m] of tally) {
    let best: string | null = null, bestN = -1;
    for (const [emp, n] of m) if (n > bestN) { best = emp; bestN = n; }
    if (best) out.set(key, best);
  }
  return out;
}
