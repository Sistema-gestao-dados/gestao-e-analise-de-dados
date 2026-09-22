import { supabase } from "@/integrations/supabase/client";

// Busca TODAS as linhas de uma tabela/view em páginas de 1000, em PARALELO
// em vez de sequencial. O padrão antigo (repetido em vários lugares do
// app) fazia `for (;;) { ...await página...; from += 1000 }` — pra uma
// tabela com 20 mil+ linhas (ex.: viagens), isso é ~21 idas-e-voltas ao
// servidor, uma esperando a anterior terminar. Aqui a gente descobre o
// total de linhas primeiro (1 requisição HEAD, sem corpo) e dispara todas
// as páginas de uma vez com Promise.all — o tempo de carregamento cai de
// "21x o round-trip" pra "~1x o round-trip" (todas voltam juntas).
//
// Não muda NENHUM dado retornado nem lógica de filtro — só a forma de
// buscar. `order` por padrão é por `id` (toda tabela do projeto tem uuid
// `id` como PK) pra garantir que as páginas não se sobreponham/percam
// linha mesmo buscando em paralelo.
export async function fetchAllPaginado<T>(
  table: string,
  select: string,
  opts?: { pageSize?: number; order?: { column: string; ascending?: boolean } },
): Promise<T[]> {
  const client = supabase as any;
  const pageSize = opts?.pageSize ?? 1000;
  const orderColumn = opts?.order?.column ?? "id";
  const ascending = opts?.order?.ascending ?? true;

  const { count, error: countError } = await client.from(table).select("*", { count: "exact", head: true });
  if (countError) throw countError;
  const total = count ?? 0;
  if (total === 0) return [];

  const pages = Math.ceil(total / pageSize);
  const requests = Array.from({ length: pages }, (_, i) =>
    client.from(table).select(select).order(orderColumn, { ascending }).range(i * pageSize, i * pageSize + pageSize - 1),
  );
  const results = await Promise.all(requests);

  const all: T[] = [];
  for (const r of results) {
    if (r.error) throw r.error;
    all.push(...((r.data ?? []) as T[]));
  }
  return all;
}
