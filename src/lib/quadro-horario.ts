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

export type Banda = { inicio: number; fim: number; intervalo: number; qtdPartidas: number };

/**
 * Agrupa uma sequência ORDENADA de horários de partida (minutos desde 0h,
 * sem duplicar) em bandas de intervalo aproximadamente constante.
 *
 * Cada novo intervalo é comparado com a MÉDIA acumulada da banda atual (não
 * com o primeiro valor) — assim um desvio isolado não "puxa" a média e
 * mascara uma mudança real de cadência. Quando o desvio passa da
 * tolerância, a banda fecha e o intervalo que estourou vira o primeiro da
 * banda seguinte.
 *
 * `fim` de cada banda é sempre uma partida REAL: o início da próxima banda
 * (ou, na última banda, a própria última partida da lista) — nunca um
 * horário projetado além do que foi realmente programado. Isso garante a
 * regra de negócio: o quadro resumido não pode terminar depois do último
 * horário real da linha.
 */
export function agruparBandas(partidasOrdenadas: number[], toleranciaMin = 5): Banda[] {
  const n = partidasOrdenadas.length;
  if (n < 2) return [];
  const intervalos = Array.from(
    { length: n - 1 },
    (_, i) => partidasOrdenadas[i + 1] - partidasOrdenadas[i],
  );

  const bandas: Banda[] = [];
  let clusterStart = 0;
  let soma = 0;
  let qtd = 0;
  for (let k = 0; k < intervalos.length; k++) {
    if (qtd > 0 && Math.abs(intervalos[k] - soma / qtd) > toleranciaMin) {
      bandas.push({
        inicio: partidasOrdenadas[clusterStart],
        fim: partidasOrdenadas[k],
        intervalo: Math.round(soma / qtd),
        qtdPartidas: qtd + 1,
      });
      clusterStart = k;
      soma = 0;
      qtd = 0;
    }
    soma += intervalos[k];
    qtd += 1;
  }
  bandas.push({
    inicio: partidasOrdenadas[clusterStart],
    fim: partidasOrdenadas[n - 1],
    intervalo: Math.round(soma / qtd),
    qtdPartidas: qtd + 1,
  });
  return bandas;
}
