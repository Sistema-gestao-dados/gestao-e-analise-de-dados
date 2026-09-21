// Fontes externas pra alimentar o calendário automaticamente:
//  - Feriados nacionais: BrasilAPI (https://brasilapi.com.br/api/feriados/v1/{ano})
//    — fonte pública, sem chave, mantida pela comunidade, cobre feriados
//    federais fixos e móveis (Páscoa, Carnaval etc.) de qualquer ano.
//  - Chuva histórica: Open-Meteo Archive API (ERA5, sem chave, cobre desde
//    1940) — precipitação diária (mm) por coordenada.
//  - Feriados municipais: NÃO existe API pública confiável pra isso no
//    Brasil (varia por lei de cada cidade). As 3 datas abaixo foram
//    pesquisadas e citam a lei/fonte — não são um feed automático, o
//    usuário confirma antes de importar (ver dialog em historico-calendario.tsx).

export type CidadeCoord = { nome: string; lat: number; lon: number };

export const CIDADES: CidadeCoord[] = [
  { nome: "Rio de Janeiro", lat: -22.9068, lon: -43.1729 },
  { nome: "Niterói", lat: -22.8858, lon: -43.1043 },
  { nome: "São Gonçalo", lat: -22.8268, lon: -43.0634 },
];

export type FeriadoMunicipal = { cidade: string; mes: number; dia: number; nome: string; fonte: string };

// Pesquisado em 2026-09-21 — Rio de Janeiro (São Sebastião, Lei 1.271/1988),
// Niterói (São João — o "aniversário" 22/11 NÃO é feriado desde 2020/2021,
// só data comemorativa/ponto facultativo por decreto anual), São Gonçalo
// (emancipação político-administrativa, Lei 434/2012). Datas fixas
// (dia/mês), reaplicadas todo ano — confirme se a lei local não mudou.
export const FERIADOS_MUNICIPAIS: FeriadoMunicipal[] = [
  { cidade: "Rio de Janeiro", mes: 1, dia: 20, nome: "São Sebastião (padroeiro do Rio de Janeiro)", fonte: "Lei Municipal nº 1.271/1988" },
  { cidade: "Niterói", mes: 6, dia: 24, nome: "São João (padroeiro de Niterói)", fonte: "Calendário oficial de feriados municipais de Niterói" },
  { cidade: "São Gonçalo", mes: 9, dia: 22, nome: "Emancipação político-administrativa de São Gonçalo", fonte: "Lei Municipal nº 434/2012" },
];

export type FeriadoNacional = { data: string; nome: string };

export async function buscarFeriadosNacionais(ano: number): Promise<FeriadoNacional[]> {
  const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
  if (!res.ok) throw new Error(`BrasilAPI respondeu ${res.status}`);
  const data = (await res.json()) as { date: string; name: string }[];
  return data.map((d) => ({ data: d.date, nome: d.name }));
}

export type ChuvaDia = { data: string; mm: number };

export async function buscarChuvaHistorica(cidade: CidadeCoord, dataInicio: string, dataFim: string): Promise<ChuvaDia[]> {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${cidade.lat}&longitude=${cidade.lon}&start_date=${dataInicio}&end_date=${dataFim}&daily=precipitation_sum&timezone=America%2FSao_Paulo`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
  const data = (await res.json()) as { daily?: { time?: string[]; precipitation_sum?: (number | null)[] } };
  const dias = data.daily?.time ?? [];
  const mm = data.daily?.precipitation_sum ?? [];
  return dias.map((d, i) => ({ data: d, mm: mm[i] ?? 0 }));
}
