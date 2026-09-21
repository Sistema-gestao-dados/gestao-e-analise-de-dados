import { supabase } from "@/integrations/supabase/client";

export type CalendarioEvento = {
  id: string;
  data_inicio: string;
  data_fim: string;
  categoria: string;
  // Restringe o período aos dias desse tipo (dia da semana) — null = todos
  // os dias do período. Ex.: período 01-30/09 + "Dias úteis" = só seg-sex.
  dia_tipo: string | null;
  linha: string | null;
  descricao: string | null;
  created_at: string;
  updated_at: string;
};

export type CalendarioEventoInput = Omit<CalendarioEvento, "id" | "created_at" | "updated_at">;

// `calendario_eventos` é uma tabela nova — só aparece nos tipos gerados do
// Supabase (src/integrations/supabase/types.ts) depois que a migração for
// aplicada e os tipos forem regenerados. Até lá, cast local (mesmo padrão já
// usado em outros pontos do código pra tabela ainda não refletida no gen).
const db = () => supabase as any;

export async function fetchCalendarioEventos(): Promise<CalendarioEvento[]> {
  const all: CalendarioEvento[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db()
      .from("calendario_eventos")
      .select("*")
      .order("data_inicio", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    const chunk = (data ?? []) as CalendarioEvento[];
    all.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return all;
}

export async function insertCalendarioEvento(row: CalendarioEventoInput): Promise<CalendarioEvento> {
  const { data, error } = await db().from("calendario_eventos").insert(row).select("*").single();
  if (error) throw error;
  return data as CalendarioEvento;
}

export async function updateCalendarioEvento(id: string, row: Partial<CalendarioEventoInput>): Promise<void> {
  const { error } = await db().from("calendario_eventos").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteCalendarioEvento(id: string): Promise<void> {
  const { error } = await db().from("calendario_eventos").delete().eq("id", id);
  if (error) throw error;
}

// Categorias sugeridas — texto livre por trás (igual dia tipo), então o
// usuário pode digitar qualquer outra em "+ Outra categoria...". As duas
// últimas são preenchidas pelos botões de importação automática (feriados).
export const CATEGORIAS_BASE = ["Tempo chuvoso", "Obras na via", "Redução operacional", "Feriado Nacional", "Feriado Municipal"];

// Dia tipo do evento — mesmo vocabulário usado no resto do sistema, mas
// aqui é interpretado por DIA DA SEMANA (seg-sex/sáb/dom), não por cadastro.
export const DIA_TIPO_OPTIONS = ["Dias úteis", "Sábado", "Domingo"];
export const DIA_TIPO_TODOS = "__todos";

// Cor padrão (hex) de cada categoria sugerida — usada só até o usuário
// trocar em "Cores" (persistido em calendario_categoria_cor). Cor é hex
// (não classe Tailwind) porque precisa poder ser qualquer valor escolhido
// em runtime num <input type="color">, e o Tailwind não gera classes pra
// cores arbitrárias que só existem em dado vindo do banco.
const CATEGORIA_COR_PADRAO: Record<string, string> = {
  "tempo chuvoso": "#3b82f6",
  "obras na via": "#f97316",
  "redução operacional": "#a855f7",
  "feriado nacional": "#16a34a",
  "feriado municipal": "#0d9488",
};
const COR_FALLBACK = "#64748b";

/** Cor (hex) pra bolinha/badge da categoria — `overrides` é o mapa vindo de
 * `calendario_categoria_cor` (customização do usuário); sem override, cai
 * na cor padrão sugerida; sem nenhuma das duas, cinza neutro. */
export function corCategoria(categoria: string, overrides?: Map<string, string>): string {
  const key = categoria.trim().toLowerCase();
  return overrides?.get(key) ?? CATEGORIA_COR_PADRAO[key] ?? COR_FALLBACK;
}

export type CategoriaCor = { categoria: string; cor: string };

// Retorna array (não Map) de propósito: isso passa por useQuery/react-query,
// que persiste o cache no localStorage via JSON — um Map vira `{}` nesse
// round-trip (perde o protótipo) e quebra `.get()` na primeira carga depois
// de um reload. Quem consome monta o Map localmente via useMemo (nunca
// cacheado pelo react-query), igual todo outro mapa derivado do app.
export async function fetchCategoriaCores(): Promise<CategoriaCor[]> {
  const { data, error } = await db().from("calendario_categoria_cor").select("categoria,cor");
  if (error) throw error;
  return (data ?? []) as CategoriaCor[];
}

export function buildCategoriaCorMap(rows: CategoriaCor[]): Map<string, string> {
  return new Map(rows.map((r) => [r.categoria.trim().toLowerCase(), r.cor]));
}

export async function salvarCategoriaCor(categoria: string, cor: string): Promise<void> {
  const { error } = await db()
    .from("calendario_categoria_cor")
    .upsert({ categoria: categoria.trim().toLowerCase(), cor }, { onConflict: "categoria" });
  if (error) throw error;
}

/** Um dia bate com o dia_tipo do evento? null = todos os dias do período;
 * senão só o dia da semana correspondente (seg-sex/sáb/dom). */
function diaBateComTipo(d: Date, diaTipo: string | null): boolean {
  if (!diaTipo) return true;
  const dow = d.getDay(); // 0=domingo .. 6=sábado
  if (diaTipo === "Dias úteis") return dow >= 1 && dow <= 5;
  if (diaTipo === "Sábado") return dow === 6;
  if (diaTipo === "Domingo") return dow === 0;
  return true;
}

/** Expande cada evento (data_inicio..data_fim) em entradas por dia, pulando
 * os dias que não batem com o dia_tipo do evento, pra montar o mapa
 * dia -> eventos que o calendário usa pra pintar as células. */
export function expandirPorDia(eventos: CalendarioEvento[]): Map<string, CalendarioEvento[]> {
  const map = new Map<string, CalendarioEvento[]>();
  for (const ev of eventos) {
    const ini = new Date(`${ev.data_inicio}T00:00:00`);
    const fim = new Date(`${ev.data_fim}T00:00:00`);
    if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime())) continue;
    const cursor = new Date(ini);
    let guard = 0;
    while (cursor <= fim && guard < 400) {
      if (diaBateComTipo(cursor, ev.dia_tipo)) {
        const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
        const arr = map.get(k) ?? [];
        arr.push(ev);
        map.set(k, arr);
      }
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  }
  return map;
}
