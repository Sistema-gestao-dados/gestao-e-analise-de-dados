// Quadro de Horário — lógica pura (sem UI), pra poder testar isolado.
// Três partes:
//  1) "Horário corrido": lista ordenada de partidas + intervalo até a
//     próxima, por Linha/Sentido/Dia Tipo/Versão.
//  2) "Quadro resumido" (botão "Gerar Quadro Resumido"): agrupa sequências
//     de partidas com intervalo parecido num único "banda" (Início/Fim/
//     Intervalo), no formato enviado ao DETRO.
//  3) "Resumo por linha" (flag "Pico/Entrepico"): 1ª/última saída e os
//     intervalos de pico/entrepico/médio — ficha técnica resumida por
//     linha, formato de planilha enviado ao DETRO.

export function parseHHMMToMin(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10);
}

export function fmtHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Partidas de madrugada (ex.: 00:30) que na verdade são a "virada" do
 * serviço da noite anterior — não o início do dia — precisam ordenar
 * DEPOIS das partidas da noite (23:xx), não antes das da manhã (04:xx).
 * Qualquer horário menor que `corteMin` (o "início do dia operacional",
 * ex.: 03:00) é empurrado +24h só pra fins de ordenação/agrupamento;
 * `fmtHHMM` já faz `% 1440` na hora de exibir, então volta a mostrar
 * "00:30" normalmente — só a posição na lista/banda muda.
 */
export function normalizarVirada(min: number, corteMin: number): number {
  return min < corteMin ? min + 1440 : min;
}

export type Banda = { inicio: number; fim: number; intervalo: number; qtdPartidas: number };

/**
 * Agrupa uma sequência ORDENADA de horários de partida (minutos desde 0h,
 * sem duplicar) em bandas de intervalo aproximadamente constante.
 *
 * Cada novo intervalo é comparado com a MÉDIA acumulada do cluster atual
 * (não com o primeiro valor) — assim um desvio isolado não "puxa" a média
 * e mascara uma mudança real de cadência. Quando o desvio passa da
 * tolerância, o cluster fecha e o intervalo que estourou vira o primeiro
 * do cluster seguinte.
 *
 * IMPORTANTE: `fim` de cada banda é sempre `inicio + intervalo * qtdPartidas`
 * — nunca um valor solto que não bate com o Intervalo mostrado (arredondar
 * a média e ainda usar a última partida real como Fim pode gerar um Fim
 * que não corresponde a nenhum múltiplo do Intervalo, ex.: Início 05:10 +
 * Intervalo 109 × 9 = 21:31, mas mostrar Fim 21:35 por ser a partida real
 * — inconsistente). Pra manter isso e AINDA garantir que o Fim da ÚLTIMA
 * banda nunca passe do último horário real da linha, as bandas são
 * encadeadas: o Início de cada banda é o Fim (já ajustado) da anterior — só
 * a primeira banda começa exatamente na primeira partida real do dia.
 */
export function agruparBandas(partidasOrdenadas: number[], toleranciaMin = 5): Banda[] {
  const n = partidasOrdenadas.length;
  if (n < 2) return [];
  const intervalosReais = Array.from(
    { length: n - 1 },
    (_, i) => partidasOrdenadas[i + 1] - partidasOrdenadas[i],
  );

  // 1ª passada: só detecta onde cada cluster começa/termina (por índice),
  // igual antes — a reconstrução de Início/Fim fica pra 2ª passada.
  const clusters: { inicioIdx: number; fimIdx: number; qtd: number }[] = [];
  let clusterStart = 0;
  let soma = 0;
  let qtd = 0;
  for (let k = 0; k < intervalosReais.length; k++) {
    if (qtd > 0 && Math.abs(intervalosReais[k] - soma / qtd) > toleranciaMin) {
      clusters.push({ inicioIdx: clusterStart, fimIdx: k, qtd });
      clusterStart = k;
      soma = 0;
      qtd = 0;
    }
    soma += intervalosReais[k];
    qtd += 1;
  }
  clusters.push({ inicioIdx: clusterStart, fimIdx: n - 1, qtd });

  // 2ª passada: reconstrói Início/Fim encadeados a partir da 1ª partida real.
  const fimRealAbsoluto = partidasOrdenadas[n - 1];
  const bandas: Banda[] = [];
  let cursor = partidasOrdenadas[0];
  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci];
    const somaReal = partidasOrdenadas[c.fimIdx] - partidasOrdenadas[c.inicioIdx];
    let intervalo = Math.round(somaReal / c.qtd);
    let fim = cursor + intervalo * c.qtd;
    const ultimaBanda = ci === clusters.length - 1;
    if (ultimaBanda && fim > fimRealAbsoluto) {
      intervalo = Math.floor(somaReal / c.qtd);
      fim = cursor + intervalo * c.qtd;
    }
    if (ultimaBanda) fim = Math.min(fim, fimRealAbsoluto);
    bandas.push({ inicio: cursor, fim, intervalo, qtdPartidas: c.qtd + 1 });
    cursor = fim;
  }
  return bandas;
}

export type ResumoLinha = {
  primeiraSaida: number | null;
  ultimaSaida: number | null;
  intervaloPico: number | null;
  intervaloForaPico: number | null;
  intervaloMedio: number | null;
};

/**
 * "Ficha técnica" resumida da linha: 1ª saída, última saída, e os
 * intervalos de Pico / Fora Pico (entrepico) / Médio — mesmo formato de
 * planilha enviado ao DETRO (1ª Saída, Última Saída, Intervalo Pico,
 * Intervalo Fora Pico).
 *
 * Usa o Sentido Ida como referência pros horários/intervalos (mais simples
 * que misturar os dois sentidos, que têm cadência própria) — EXCETO a
 * Última Saída, que olha os dois sentidos (a Volta costuma terminar mais
 * tarde que a Ida, e "última saída da linha" é a última partida real,
 * independente de sentido).
 *
 * Pico = banda(s) de MENOR intervalo entre as partidas de Ida (maior
 * frequência = horário de pico); se houver mais de uma banda empatada no
 * mínimo (ex.: pico da manhã + pico da tarde), tira a média delas.
 * Fora Pico (entrepico) = a próxima faixa de frequência acima do pico (o
 * 2º menor intervalo distinto entre as bandas) — não "a banda que dura
 * mais tempo", que podia pegar a redução do fim da noite (que tende a ter
 * o intervalo mais largo do dia, não o entrepico de verdade) em vez da
 * cadência do meio do dia.
 * Médio = intervalo médio ao longo do dia inteiro (último − primeiro,
 * dividido pela quantidade de intervalos).
 * Todos os intervalos arredondam PRA CIMA (Math.ceil), a pedido explícito
 * — o quadro nunca deve prometer um intervalo mais curto do que o real.
 */
export function calcularResumoLinha(
  partidasIda: number[],
  partidasVolta: number[],
  toleranciaMin = 5,
): ResumoLinha {
  const todasPartidas = [...partidasIda, ...partidasVolta];
  if (todasPartidas.length === 0) {
    return { primeiraSaida: null, ultimaSaida: null, intervaloPico: null, intervaloForaPico: null, intervaloMedio: null };
  }
  const primeiraSaida = partidasIda.length > 0 ? Math.min(...partidasIda) : Math.min(...todasPartidas);
  const ultimaSaida = Math.max(...todasPartidas);

  const bandas = agruparBandas(partidasIda, toleranciaMin);
  let intervaloPico: number | null = null;
  let intervaloForaPico: number | null = null;
  if (bandas.length > 0) {
    const minIntervalo = Math.min(...bandas.map((b) => b.intervalo));
    const bandasPico = bandas.filter((b) => b.intervalo === minIntervalo);
    intervaloPico = Math.ceil(bandasPico.reduce((s, b) => s + b.intervalo, 0) / bandasPico.length);

    const valoresAcimaDoPico = bandas.map((b) => b.intervalo).filter((v) => v > minIntervalo);
    if (valoresAcimaDoPico.length > 0) {
      const segundoMenor = Math.min(...valoresAcimaDoPico);
      const bandasForaPico = bandas.filter((b) => b.intervalo === segundoMenor);
      intervaloForaPico = Math.ceil(
        bandasForaPico.reduce((s, b) => s + b.intervalo, 0) / bandasForaPico.length,
      );
    }
  }

  const intervaloMedio =
    partidasIda.length > 1
      ? Math.ceil((partidasIda[partidasIda.length - 1] - partidasIda[0]) / (partidasIda.length - 1))
      : null;

  return { primeiraSaida, ultimaSaida, intervaloPico, intervaloForaPico, intervaloMedio };
}
