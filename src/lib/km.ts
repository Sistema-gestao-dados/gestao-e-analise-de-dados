// Cálculo de quilometragem robusto:
// 1) Normalização (trim + upper + strip de acentos) para tolerar variação
//    de caixa e diacríticos entre `viagens` e `parametro_km`.
// 2) Suporte a mojibake (U+FFFD "�") vindo de importações mal-decodificadas:
//    tenta casar como padrão regex (cada � = 1 caractere) contra os trechos
//    já cadastrados para a mesma linha.
// 3) Fallbacks seguros: exato → reverso → regex (por causa de mojibake) →
//    reverso regex → 0. Nunca estima KM pela média da linha: isso transforma
//    ausência de cadastro em quilometragem fictícia nos relatórios.

import type { ParametroKm } from "@/lib/data";
import { supabase } from "@/integrations/supabase/client";

export type KmMaps = {
  trecho: Map<string, number>;                       // linha|origem|destino -> km
  porLinha: Map<string, { o: string; d: string; km: number }[]>; // linha -> lista de trechos
};

export type KmResult = {
  km: number;
  fonte: "direto" | "reverso" | "normalizado" | "reverso_normalizado" | "sem_cadastro";
};

const REPLACEMENT = "\uFFFD"; // �

/** Normaliza texto para comparação: trim + upper + remove acentos. Mantém `�`. */
export function normKey(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Converte string com `�` em regex (cada � = 1 char qualquer). */
function keyToRegex(k: string): RegExp | null {
  if (!k.includes(REPLACEMENT)) return null;
  const parts = k.split(REPLACEMENT).map(escapeRegex);
  return new RegExp("^" + parts.join(".") + "$");
}

export function buildKmMaps(km: ParametroKm[]): KmMaps {
  const trecho = new Map<string, number>();
  const porLinha = new Map<string, { o: string; d: string; km: number }[]>();
  for (const k of km) {
    // Toda linha da tabela parametro_km é um cadastro intencional (a coluna
    // é NOT NULL DEFAULT 0) — não existe jeito de "não preencher" o KM.
    // Por isso NÃO descartamos km <= 0 aqui: fazer isso faz o sistema tratar
    // um trecho cadastrado como 0.0 km (ex.: linhas 01/01A em certos pontos)
    // como se fosse "sem cadastro", o que é errado — são coisas diferentes.
    const kmv = Number(k.km ?? 0);
    if (!Number.isFinite(kmv) || kmv < 0) continue;
    const l = normKey(k.linha);
    const o = normKey(k.origem);
    const d = normKey(k.destino);
    trecho.set(`${l}|${o}|${d}`, kmv);
    if (!porLinha.has(l)) porLinha.set(l, []);
    porLinha.get(l)!.push({ o, d, km: kmv });
  }
  return { trecho, porLinha };
}

export function viagemKmResult(
  v: { linha: string; origem: string | null; destino: string | null },
  maps: KmMaps,
): KmResult {
  const l = normKey(v.linha);
  const o = normKey(v.origem);
  const d = normKey(v.destino);

  // 1) exato
  const direct = maps.trecho.get(`${l}|${o}|${d}`);
  if (direct != null) return { km: direct, fonte: "direto" };
  // 2) reverso
  const rev = maps.trecho.get(`${l}|${d}|${o}`);
  if (rev != null) return { km: rev, fonte: "reverso" };

  // 3/4) mojibake -> regex sobre trechos cadastrados da mesma linha
  const list = maps.porLinha.get(l);
  if (list) {
    const rxO = keyToRegex(o);
    const rxD = keyToRegex(d);
    if (rxO || rxD) {
      const diretos = list.filter((t) => {
        const okO = rxO ? rxO.test(t.o) : o === t.o;
        const okD = rxD ? rxD.test(t.d) : d === t.d;
        return okO && okD;
      });
      if (diretos.length === 1) return { km: diretos[0].km, fonte: "normalizado" };
      if (diretos.length > 1) return { km: 0, fonte: "sem_cadastro" };
      const reversos = list.filter((t) => {
        const okO = rxO ? rxO.test(t.d) : o === t.d;
        const okD = rxD ? rxD.test(t.o) : d === t.o;
        return okO && okD;
      });
      if (reversos.length === 1) return { km: reversos[0].km, fonte: "reverso_normalizado" };
    }
  }

  return { km: 0, fonte: "sem_cadastro" };
}

export function viagemKm(
  v: { linha: string; origem: string | null; destino: string | null },
  maps: KmMaps,
): number {
  return viagemKmResult(v, maps).km;
}

/** Formatação padrão pt-BR para KM: separador de milhar, 1 casa decimal quando existir. */
export function fmtKm(n: number, decimals = 1): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

export function fmtInt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** Sentido normalizado: GPS Cittati já vem "Ida"/"Volta"; EasyBus vem cru
 *  do TXT (ex.: "IDA", "VOLTA", "I", "V"). */
export function normSentido(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  const u = t.toUpperCase();
  if (u.startsWith("I")) return "Ida";
  if (u.startsWith("V")) return "Volta";
  return t;
}

/** Chave de trecho (linha + origem + destino), sem acento/maiúscula. */
export const chaveTrecho = (linha: string, origem: string, destino: string) =>
  `${linha.trim()}||${normKey(origem)}||${normKey(destino)}`;

/** Sentido de cada trecho segundo as viagens importadas: o mais frequente
 *  (um trecho pode aparecer com os dois sentidos em casos raros, ex.:
 *  linha circular/garagem). */
export async function fetchSentidoPorTrecho(): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("viagens_sentido_por_trecho");
  if (error) throw error;
  const cont = new Map<string, Map<string, number>>();
  for (const r of data ?? []) {
    const k = chaveTrecho(r.linha, r.origem, r.destino);
    const sent = normSentido(r.sentido);
    if (!sent) continue;
    if (!cont.has(k)) cont.set(k, new Map());
    const m = cont.get(k)!;
    m.set(sent, (m.get(sent) ?? 0) + Number(r.viagens));
  }
  const out = new Map<string, string>();
  for (const [k, m] of cont) out.set(k, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}
