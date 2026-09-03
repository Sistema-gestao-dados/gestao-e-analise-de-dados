// Lógica de agregação operacional: SERVIÇO / FROTA / APROVEITAMENTO / TU
//
// UNIDADE DE SERVIÇO (motorista/turno de trabalho):
//   - TU         → key = versao||servico||TU              (conta uma única vez)
//   - DIR T1     → key = versao||servico||DIR||T1
//   - DIR T2     → key = versao||servico||DIR||T2
//   - APROV (T3) → key = versao||servico||DIR||T3
//
// FROTA (veículo físico): o MESMO carro pode operar T1/T2/T3 e também
// aparecer como TU com o mesmo número de serviço. Portanto frota é o número
// de veículos distintos por (versao, servico), independente de tipo_servico
// ou turno. Reaproveitamentos (T3) e TU com nº já existente usam veículo já
// contado.

export type ViagemLite = {
  id: string;
  linha: string;
  tipo_operacao: string | null;
  tipo_servico: string | null;
  servico: string | null;
  carro?: string | null; // = servico (coluna gerada); 1 carro = 1 nº de serviço
  turno: string | null;
  versao_programacao: string | null;
  origem: string | null;
  destino: string | null;
  tipo_movimento: string | null;
  categoria_movimento: string | null;
  partida: string | null;
  chegada: string | null;
  sentido?: string | null;
  tempo_viagem?: string | null;
  arquivo?: string | null;
  created_at: string;
};

export type Bucket = "DIR_T1" | "DIR_T2" | "APROV" | "TU";

/**
 * FLAG de regra de contagem/atribuição de SERVIÇO e FROTA por linha:
 *  - "predominancia"    → a linha onde o serviço/veículo tem MAIS partidas/viagens.
 *  - "primeira_partida" → a linha da PRIMEIRA partida comercial do serviço/veículo.
 */
export type CriterioLinha = "predominancia" | "primeira_partida";

export type ServiceUnit = {
  key: string;
  bucket: Bucket;
  versao: string;
  tipo_operacao: string;
  servico: string;
  tipo_servico: string;
  turno: string;
  vehicleKey: string; // veículo físico (versao||dia-tipo||servico)
  viagensIds: string[];
  partidasCount: number;
  kmTotal: number;
  viagensPorLinha: Map<string, number>;
  partidasPorLinha: Map<string, number>;
  kmPorLinha: Map<string, number>;
  primeiraPartidaPorLinha: Map<string, number>; // minutos da 1ª partida comercial por linha
};


// Sentinela pra "sem grupo definido" ficar sempre por último na ordenação
// (já que "grupo" agora é texto livre, não dá pra usar Infinity como antes).
const GRUPO_AUSENTE = "\uffff\uffff\uffff\uffff";

function compareGrupo(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
}

export type AggRow = {
  groupKey: string;
  groupLabel: string;
  groupOrder: string; // para ordenação (ordem alfanumérica natural; ausente = por último)
  dir1: number;
  dir2: number;
  aprov: number;
  tu: number;
  totalServico: number; // soma de unidades operacionais
  frota: number;        // veículos físicos distintos (pico)
  partidas: number;
  km: number;
  heMin: number; // horas extras programadas (minutos) — preenchido sob demanda
};

function unitKey(v: ViagemLite): { key: string; bucket: Bucket } | null {
  const ts = (v.tipo_servico ?? "").toUpperCase();
  const sv = v.servico ?? "";
  const ver = v.versao_programacao ?? "";
  const dia = v.tipo_operacao ?? "";
  const tu = (v.turno ?? "").trim();
  if (!sv || !ver) return null;
  if (ts === "TU") return { key: `${ver}||${dia}||${sv}||TU`, bucket: "TU" };
  if (ts === "DIR") {
    if (tu === "1") return { key: `${ver}||${dia}||${sv}||DIR||T1`, bucket: "DIR_T1" };
    if (tu === "2") return { key: `${ver}||${dia}||${sv}||DIR||T2`, bucket: "DIR_T2" };
    if (tu === "3") return { key: `${ver}||${dia}||${sv}||DIR||T3`, bucket: "APROV" };
  }
  return null;
}

export function buildServiceUnits(
  viagens: ViagemLite[],
  kmFn: (v: ViagemLite) => number,
): Map<string, ServiceUnit> {
  const units = new Map<string, ServiceUnit>();
  for (const v of viagens) {
    const k = unitKey(v);
    if (!k) continue;
    let u = units.get(k.key);
    if (!u) {
      const ts = (v.tipo_servico ?? "").toUpperCase();
      u = {
        key: k.key,
        bucket: k.bucket,
        versao: v.versao_programacao ?? "",
        tipo_operacao: v.tipo_operacao ?? "",
        servico: v.servico ?? "",
        tipo_servico: ts,
        turno: k.bucket === "TU" ? "" : (v.turno ?? ""),
        // FROTA: 1 CARRO = 1 nº de SERVIÇO. Independente de turno OU tipo_servico.
        // TU#01 e DIR#01 na mesma versão = MESMO carro (001). Rendição idem.
        // Inclui o dia-tipo para não colidir o mesmo número entre projetos.
        vehicleKey: `${v.versao_programacao ?? ""}||${v.tipo_operacao ?? ""}||${v.servico ?? ""}`,
        viagensIds: [],
        partidasCount: 0,
        kmTotal: 0,
        viagensPorLinha: new Map(),
        partidasPorLinha: new Map(),
        kmPorLinha: new Map(),
        primeiraPartidaPorLinha: new Map(),
      };
      units.set(k.key, u);
    }
    u.viagensIds.push(v.id);
    const isPartida = (v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL" && Boolean(v.partida);
    if (isPartida) {
      u.partidasCount += 1;
      u.partidasPorLinha.set(v.linha, (u.partidasPorLinha.get(v.linha) ?? 0) + 1);
      const min = parseTimeToMinutes(v.partida);
      if (min != null) {
        const atual = u.primeiraPartidaPorLinha.get(v.linha);
        if (atual == null || min < atual) u.primeiraPartidaPorLinha.set(v.linha, min);
      }
    }
    const kmViagem = kmFn(v);
    u.kmTotal += kmViagem;
    u.kmPorLinha.set(v.linha, (u.kmPorLinha.get(v.linha) ?? 0) + kmViagem);
    u.viagensPorLinha.set(v.linha, (u.viagensPorLinha.get(v.linha) ?? 0) + 1);
  }
  return units;
}

export function dominantLinha(u: ServiceUnit, criterio: CriterioLinha = "predominancia"): string {
  if (criterio === "primeira_partida") {
    let best: string | null = null;
    let bestMin = Number.POSITIVE_INFINITY;
    for (const [linha, min] of u.primeiraPartidaPorLinha) {
      if (min < bestMin || (min === bestMin && best != null && linha < best)) {
        best = linha;
        bestMin = min;
      }
    }
    if (best) return best;
  }
  // PREDOMINÂNCIA = maior número de PARTIDAS COMERCIAIS da unidade na linha.
  // (antes contava todas as viagens, incluindo deslocamentos/ligações de
  // garagem, o que distorcia a atribuição em serviços multi-linha.)
  const pick = (m: Map<string, number>): string | null => {
    let best: string | null = null;
    let bestCount = -1;
    for (const [linha, n] of m) {
      if (n > bestCount || (n === bestCount && best != null && linha < best)) {
        best = linha;
        bestCount = n;
      }
    }
    return best;
  };
  // desempate 1: primeira partida comercial; desempate 2: total de viagens.
  const porPartidas = u.partidasPorLinha;
  if (porPartidas.size) {
    const maxN = Math.max(...porPartidas.values());
    const empatadas = Array.from(porPartidas.entries()).filter(([, n]) => n === maxN).map(([l]) => l);
    if (empatadas.length === 1) return empatadas[0];
    let bestL: string | null = null;
    let bestMin = Number.POSITIVE_INFINITY;
    for (const l of empatadas) {
      const min = u.primeiraPartidaPorLinha.get(l);
      if (min != null && (min < bestMin || (min === bestMin && bestL != null && l < bestL))) { bestL = l; bestMin = min; }
    }
    if (bestL) return bestL;
    return empatadas.sort()[0];
  }
  return pick(u.viagensPorLinha) ?? "—";
}


export function aggregateByGroup(
  units: Map<string, ServiceUnit>,
  groupOf: (u: ServiceUnit) => { key: string; label: string; order?: string },
): AggRow[] {
  const rows = new Map<string, AggRow>();
  const vehiclesPerGroup = new Map<string, Set<string>>();

  for (const u of units.values()) {
    const g = groupOf(u);
    let r = rows.get(g.key);
    if (!r) {
      r = {
        groupKey: g.key,
        groupLabel: g.label,
        groupOrder: g.order ?? GRUPO_AUSENTE,
        dir1: 0, dir2: 0, aprov: 0, tu: 0,
        totalServico: 0, frota: 0, partidas: 0, km: 0, heMin: 0,
      };
      rows.set(g.key, r);
      vehiclesPerGroup.set(g.key, new Set());
    }
    if (u.bucket === "DIR_T1") r.dir1 += 1;
    else if (u.bucket === "DIR_T2") r.dir2 += 1;
    else if (u.bucket === "APROV") r.aprov += 1;
    else if (u.bucket === "TU") r.tu += 1;
    r.partidas += u.partidasCount;
    r.km += u.kmTotal;
    vehiclesPerGroup.get(g.key)!.add(u.vehicleKey);
  }
  for (const [k, r] of rows) {
    r.totalServico = r.dir1 + r.dir2 + r.aprov + r.tu;
    // Frota = veículos físicos distintos (mesmo servico em T1+T2 = 1 veículo).
    r.frota = vehiclesPerGroup.get(k)!.size;
  }
  return Array.from(rows.values()).sort((a, b) => {
    if (a.groupOrder !== b.groupOrder) return compareGrupo(a.groupOrder, b.groupOrder);
    return a.groupLabel.localeCompare(b.groupLabel);
  });
}

function parseTimeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function firstOperationalTurno(viagens: ViagemLite[]): string | null {
  const numericTurnos = viagens
    .map((v) => Number.parseInt((v.turno ?? "").trim(), 10))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return numericTurnos.length ? String(numericTurnos[0]) : null;
}

function predominantLineWithDepartureTieBreak(viagens: ViagemLite[], fallbackViagens?: ViagemLite[]): string | null {
  if (!viagens.length) return null;

  const porLinha = new Map<string, number>();
  for (const v of viagens) porLinha.set(v.linha, (porLinha.get(v.linha) ?? 0) + 1);

  const maxN = Math.max(...porLinha.values());
  const empatadas = Array.from(porLinha.entries())
    .filter(([, n]) => n === maxN)
    .map(([linha]) => linha)
    .sort();

  if (empatadas.length === 1) return empatadas[0];

  // Quando o 1º turno empata por uma única viagem de conexão em mais de uma
  // linha, a primeira partida pode apontar para uma ligação e não para a frota
  // operacional real. Nesses casos, desempata pela predominância do dia entre
  // as linhas empatadas; só se o empate persistir usa a primeira partida.
  if (fallbackViagens?.length) {
    const fallbackPorLinha = new Map<string, number>();
    for (const v of fallbackViagens) {
      if (!empatadas.includes(v.linha)) continue;
      fallbackPorLinha.set(v.linha, (fallbackPorLinha.get(v.linha) ?? 0) + 1);
    }
    if (fallbackPorLinha.size) {
      const fallbackMax = Math.max(...fallbackPorLinha.values());
      const fallbackEmpatadas = Array.from(fallbackPorLinha.entries())
        .filter(([, n]) => n === fallbackMax)
        .map(([linha]) => linha);
      if (fallbackEmpatadas.length === 1) return fallbackEmpatadas[0];
    }
  }

  const partidas = viagens
    .filter((v) => empatadas.includes(v.linha))
    .map((v) => ({ linha: v.linha, minutes: parseTimeToMinutes(v.partida) }))
    .filter((v): v is { linha: string; minutes: number } => v.minutes != null)
    .sort((a, b) => a.minutes - b.minutes || a.linha.localeCompare(b.linha));

  return partidas[0]?.linha ?? empatadas[0];
}

/**
 * Aggregate por linha (regra 14): cada UNIDADE de serviço é alocada à linha
 * onde essa própria unidade realiza mais viagens. Assim um serviço DIR T1
 * fica na linha efetivamente rodada no 1º turno, e DIR T2 do mesmo veículo
 * pode ficar em outra linha se for o caso.
 */

/**
 * REGRA DE FROTA — linha de origem do veículo:
 *
 * Testado com dados reais de exportação: veículos costumam ter 1 viagem
 * comercial "de ligação" logo no início do turno (ex.: garagem → ponto de
 * início, numa linha de conexão) e outra "de ligação" no fim do turno
 * (ponto final → garagem), com a operação real do dia concentrada em outra
 * linha (ex.: 10+ viagens). Como essas viagens de ligação são cronologicamente
 * a 1ª e a última do dia, usar "1ª viagem comercial" como regra jogava o
 * veículo inteiro para a linha de ligação — resultado invertido e
 * incompatível com a frota real (validado: usar a linha predominante bateu
 * exatamente com os números corretos de operação, enquanto "1ª viagem"
 * invertia os totais).
 *
 * A conferência operacional mostrou que a origem de frota por linha deve ser
 * definida pelo primeiro turno comercial efetivo do veículo, não pela soma do
 * dia inteiro nem pelo 2º turno. Isso evita jogar carros iniciados na linha A
 * para a linha B apenas porque foram aproveitados/rendidos mais tarde.
 */
export function vehicleOrigemLinha(
  allViagens: ViagemLite[],
  criterio: CriterioLinha = "predominancia",
): Map<string, string> {
  const porVeiculo = new Map<string, ViagemLite[]>();
  for (const v of allViagens) {
    if (!v.servico || !v.versao_programacao) continue;
    const vk = `${v.versao_programacao}||${v.tipo_operacao ?? ""}||${v.servico}`;
    if (!porVeiculo.has(vk)) porVeiculo.set(vk, []);
    porVeiculo.get(vk)!.push(v);
  }
  const origem = new Map<string, string>();
  for (const [vk, trips] of porVeiculo) {
    // Só PARTIDAS comerciais efetivas entram na contagem de predominância —
    // viagens sem horário de partida não representam partida programada.
    const comerciais = trips.filter((v) =>
      (v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL"
      && (v.categoria_movimento ?? "").trim().toUpperCase() !== "DESLOCAMENTO"
      && Boolean(v.partida)
    );
    if (!comerciais.length) continue;

    if (criterio === "primeira_partida") {
      // Regra alternativa: o veículo pertence à linha da sua PRIMEIRA partida
      // comercial do dia, independente de onde rodou mais.
      const ordenadas = comerciais
        .map((v) => ({ linha: v.linha, minutes: parseTimeToMinutes(v.partida) }))
        .filter((x): x is { linha: string; minutes: number } => x.minutes != null)
        .sort((a, b) => a.minutes - b.minutes || a.linha.localeCompare(b.linha));
      if (ordenadas.length) {
        origem.set(vk, ordenadas[0].linha);
        continue;
      }
    }

    const primeiroTurno = firstOperationalTurno(comerciais);
    const baseOrigem = primeiroTurno
      ? comerciais.filter((v) => (v.turno ?? "").trim() === primeiroTurno)
      : comerciais;
    const linhaOrigem = predominantLineWithDepartureTieBreak(baseOrigem, comerciais);

    if (linhaOrigem) {
      origem.set(vk, linhaOrigem);
      continue;
    }
  }

  return origem;
}

/**
 * Validação obrigatória: a soma da Frota de todas as linhas deve ser
 * exatamente igual à quantidade de veículos distintos. Se um veículo não
 * tiver nenhuma viagem comercial identificável, ele fica "sem origem" e a
 * soma por linha fica menor que o total — sinal de inconsistência de dados
 * que precisa ser revisada (ex.: viagens mal classificadas na importação).
 */
export function validarConsistenciaFrota(
  units: Map<string, ServiceUnit>,
  allViagens: ViagemLite[],
): { totalVeiculos: number; veiculosComOrigem: number; veiculosSemOrigem: number; ok: boolean; mensagem: string | null } {
  const origem = vehicleOrigemLinha(allViagens);
  const veiculos = new Set(Array.from(units.values()).map((u) => u.vehicleKey));
  let comOrigem = 0;
  for (const vk of veiculos) if (origem.has(vk)) comOrigem++;
  const semOrigem = veiculos.size - comOrigem;
  return {
    totalVeiculos: veiculos.size,
    veiculosComOrigem: comOrigem,
    veiculosSemOrigem: semOrigem,
    ok: semOrigem === 0,
    mensagem: semOrigem > 0
      ? `Inconsistência detectada. ${semOrigem} veículo(s) sem nenhuma viagem comercial identificável para definir a linha de origem (verifique a classificação de tipo_movimento/categoria_movimento na importação).`
      : null,
  };
}

export function aggregateByLinha(
  units: Map<string, ServiceUnit>,
  allViagens: ViagemLite[],
  ordemMap?: Map<string, string | null>,
  /**
   * Universo de viagens usado APENAS para determinar a linha de origem do
   * veículo (regra de frota). Deve ser o conjunto de viagens SEM o filtro de
   * linha aplicado — assim um carro cuja origem é outra linha (fora do filtro
   * de tela) não é contado erroneamente como frota da linha filtrada. Demais
   * filtros (dia, versão, empresa, categoria, grupo, faixa) devem continuar
   * aplicados para manter a coerência do recorte. Se omitido, cai em
   * `allViagens` (comportamento anterior).
   */
  viagensParaOrigem?: ViagemLite[],
  /** Regra de atribuição do serviço/veículo à linha. */
  criterio: CriterioLinha = "predominancia",
): AggRow[] {
  const rows = aggregateByGroup(units, (u) => {
    const l = dominantLinha(u, criterio);
    const ord = ordemMap?.get(l);
    return { key: l, label: l, order: ord == null ? undefined : ord };
  });


  // Serviços seguem a Regra 14 (linha dominante da unidade). KM e partidas,
  // porém, pertencem à linha em que cada viagem ocorreu. A implementação
  // anterior jogava o movimento inteiro na linha dominante e distorcia esses
  // dois indicadores em linhas compartilhadas.
  const rowsMap = new Map(rows.map((r) => [r.groupKey, r]));
  for (const r of rows) { r.partidas = 0; r.km = 0; }
  const ensureRow = (linha: string) => {
    const existing = rowsMap.get(linha);
    if (existing) return existing;
    const ord = ordemMap?.get(linha);
    const created: AggRow = {
      groupKey: linha, groupLabel: linha,
      groupOrder: ord == null ? GRUPO_AUSENTE : ord,
      dir1: 0, dir2: 0, aprov: 0, tu: 0, totalServico: 0,
      frota: 0, partidas: 0, km: 0, heMin: 0,
    };
    rows.push(created);
    rowsMap.set(linha, created);
    return created;
  };
  for (const u of units.values()) {
    for (const [linha, partidas] of u.partidasPorLinha) ensureRow(linha).partidas += partidas;
    for (const [linha, km] of u.kmPorLinha) ensureRow(linha).km += km;
  }

  // FROTA por linha = veículos cuja linha de origem (predominante) pertence a
  // essa linha. Um carro nunca é contado em duas linhas; o restante das
  // viagens dele é Aproveitamento. A origem SEMPRE é decidida no universo
  // completo do recorte (sem filtro de linha) para evitar reatribuir carros
  // de outras linhas à linha filtrada.
  const origem = vehicleOrigemLinha(viagensParaOrigem ?? allViagens, criterio);
  const vehPerLinha = new Map<string, Set<string>>();
  for (const u of units.values()) {
    const linha = origem.get(u.vehicleKey);
    if (!linha) continue;
    if (!vehPerLinha.has(linha)) vehPerLinha.set(linha, new Set());
    vehPerLinha.get(linha)!.add(u.vehicleKey);
  }
  for (const r of rows) {
    r.frota = vehPerLinha.get(r.groupKey)?.size ?? 0;
  }
  return rows.sort((a, b) => compareGrupo(a.groupOrder, b.groupOrder) || a.groupLabel.localeCompare(b.groupLabel));
}

/**
 * Indicadores de Aproveitamento por linha, exigidos pela regra de Frota:
 *   - recebido: veículos ORIUNDOS de outra linha que rodaram nesta.
 *   - cedido: veículos DESTA linha que rodaram em outras.
 *   - exclusivos: veículos que só rodaram na própria linha de origem.
 *   - compartilhados: veículos da linha que fizeram aproveitamento em outra.
 */
export function computeAproveitamento(
  units: Map<string, ServiceUnit>,
  allViagens: ViagemLite[],
  criterio: CriterioLinha = "predominancia",
): Map<string, { recebido: number; cedido: number; exclusivos: number; compartilhados: number }> {
  const origem = vehicleOrigemLinha(allViagens, criterio);

  // todas as linhas onde cada veículo efetivamente rodou (para achar aproveitamento recebido)
  const linhasPorVeiculo = new Map<string, Set<string>>();
  for (const u of units.values()) {
    let s = linhasPorVeiculo.get(u.vehicleKey);
    if (!s) { s = new Set(); linhasPorVeiculo.set(u.vehicleKey, s); }
    for (const linha of u.viagensPorLinha.keys()) s.add(linha);
  }

  const out = new Map<string, { recebido: number; cedido: number; exclusivos: number; compartilhados: number }>();
  const ensure = (linha: string) => {
    if (!out.has(linha)) out.set(linha, { recebido: 0, cedido: 0, exclusivos: 0, compartilhados: 0 });
    return out.get(linha)!;
  };

  for (const [vk, linhasRodadas] of linhasPorVeiculo) {
    const linhaOrigem = origem.get(vk);
    if (!linhaOrigem) continue;
    ensure(linhaOrigem);
    const outrasLinhas = Array.from(linhasRodadas).filter((l) => l !== linhaOrigem);
    if (outrasLinhas.length === 0) {
      ensure(linhaOrigem).exclusivos += 1;
    } else {
      ensure(linhaOrigem).compartilhados += 1;
      ensure(linhaOrigem).cedido += outrasLinhas.length;
      for (const l of outrasLinhas) ensure(l).recebido += 1;
    }
  }
  return out;
}

/**
 * Detecta serviços TU incompletos: TU deve ter os DOIS turnos (T1 e T2) do
 * mesmo motorista. Se aparecer TU com apenas 1 turno cadastrado, é erro de
 * cadastro (badge de alerta na UI). Baseado no `turno` das viagens do bucket TU.
 */
export function detectTUIncompletos(
  units: Map<string, ServiceUnit>,
  allViagens: ViagemLite[],
): { versao: string; servico: string; turnosPresentes: string[] }[] {
  // Mapear TU units -> turnos vistos nas viagens
  const tuUnits = Array.from(units.values()).filter((u) => u.bucket === "TU");
  const turnosPor = new Map<string, Set<string>>();
  for (const v of allViagens) {
    if ((v.tipo_servico ?? "").toUpperCase() !== "TU") continue;
    const key = `${v.versao_programacao ?? ""}||${v.tipo_operacao ?? ""}||${v.servico ?? ""}`;
    const t = (v.turno ?? "").trim();
    if (!t) continue;
    if (!turnosPor.has(key)) turnosPor.set(key, new Set());
    turnosPor.get(key)!.add(t);
  }
  const out: { versao: string; servico: string; turnosPresentes: string[] }[] = [];
  for (const u of tuUnits) {
    const key = `${u.versao}||${u.tipo_operacao}||${u.servico}`;
    const turnos = Array.from(turnosPor.get(key) ?? []);
    const temT1 = turnos.includes("1");
    const temT2 = turnos.includes("2");
    if (!(temT1 && temT2)) {
      out.push({ versao: u.versao, servico: u.servico, turnosPresentes: turnos.sort() });
    }
  }
  return out;
}
