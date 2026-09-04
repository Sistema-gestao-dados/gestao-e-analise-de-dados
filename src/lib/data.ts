import { supabase } from "@/integrations/supabase/client";

export type Linha = {
  linha: string;
  empresa: string | null;
  unidade: string | null;
  ordem: string | null;
  categoria: string | null;
  antec_t1?: number | null;
  prest_t1?: number | null;
  antec_t2?: number | null;
  prest_t2?: number | null;
  antec_t3?: number | null;
  prest_t3?: number | null;
};

export type ParametroKm = {
  id: string;
  linha: string;
  origem: string;
  destino: string;
  km: number;
  descricao: string | null;
};

export type ParametroMulti = {
  id: string;
  linha: string;
  grupo_du: string;
  tipo_dia: string;
};

export type LinhaEmpresaEstacao = {
  id: string;
  linha: string;
  estacao: string;
  empresa: string;
};

export type Importacao = {
  id: string;
  tipo: string;
  arquivo: string | null;
  registros_inseridos: number;
  registros_atualizados: number;
  registros_erro: number;
  created_at: string;
};

async function fetchAllRows<T>(table: "linhas" | "parametro_km" | "parametro_multilinha" | "linha_empresa_estacao", order?: string): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select("*").range(from, from + 999);
    if (order) query = query.order(order, { ascending: true, nullsFirst: false });
    const { data, error } = await query;
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    all.push(...chunk);
    if (chunk.length < 1000) return all;
  }
}

export async function fetchLinhas(): Promise<Linha[]> {
  return fetchAllRows<Linha>("linhas", "ordem");
}

export async function fetchKm(): Promise<ParametroKm[]> {
  return fetchAllRows<ParametroKm>("parametro_km");
}

export async function fetchMulti(): Promise<ParametroMulti[]> {
  return fetchAllRows<ParametroMulti>("parametro_multilinha");
}

export async function fetchEmpresaEstacao(): Promise<LinhaEmpresaEstacao[]> {
  return fetchAllRows<LinhaEmpresaEstacao>("linha_empresa_estacao");
}

export async function fetchImportacoes(): Promise<Importacao[]> {
  const { data, error } = await supabase.from("importacoes").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as Importacao[];
}
