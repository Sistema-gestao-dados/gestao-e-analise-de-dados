// Quadro de Horário — lógica pura (sem UI), pra poder testar isolado.
// Duas partes:
//  1) "Horário corrido": lista ordenada de partidas + intervalo até a
//     próxima, por Linha/Sentido/Dia Tipo/Versão.
//  2) "Quadro resumido" (botão "Gerar Quadro Resumido"): agrupa sequências
//     de partidas com intervalo parecido num único "banda" (Início/Fim/
//     Intervalo), no formato enviado ao DETRO.

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
