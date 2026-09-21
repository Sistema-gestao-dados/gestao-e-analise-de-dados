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
// usuário pode digitar qualquer outra em "+ Outra categoria...".
export const CATEGORIAS_BASE = ["Tempo chuvoso", "Obras na via", "Redução operacional"];

// Dia tipo do evento — mesmo vocabulário usado no resto do sistema, mas
// aqui é interpretado por DIA DA SEMANA (seg-sex/sáb/dom), não por cadastro.
export const DIA_TIPO_OPTIONS = ["Dias úteis", "Sábado", "Domingo"];
export const DIA_TIPO_TODOS = "__todos";

const CATEGORIA_COR: Record<string, string> = {
  "tempo chuvoso": "bg-blue-500",
  "obras na via": "bg-orange-500",
  "redução operacional": "bg-purple-500",
};

/** Cor (classe Tailwind bg-*) pra bolinha/badge da categoria — as 3
 * sugeridas têm cor fixa, qualquer outra cai num cinza neutro. */
export function corCategoria(categoria: string): string {
  return CATEGORIA_COR[categoria.trim().toLowerCase()] ?? "bg-slate-500";
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
