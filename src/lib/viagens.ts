import { supabase } from "@/integrations/supabase/client";
import type { ViagemLite } from "@/lib/resumo";
import { fetchAllPaginado } from "@/lib/fetch-paginado";

export async function fetchAllViagens(): Promise<ViagemLite[]> {
  return fetchAllPaginado<ViagemLite>(
    "viagens",
    "id,linha,tipo_operacao,tipo_servico,servico,carro,turno,versao_programacao,origem,destino,tipo_movimento,categoria_movimento,sentido,partida,chegada,tempo_viagem,arquivo,created_at",
  );
}

export type ViagensValoresDistintos = { tipos_operacao: string[]; versoes: string[]; arquivos: string[] };

/** Valores distintos (Dia Tipo/Versão/Arquivo) calculados no Postgres via
 *  RPC — usado pelo filtro da tela de Viagens. Não baixa a tabela inteira
 *  pra montar essas listas no navegador; o servidor já manda só o distinto. */
export async function fetchViagensValoresDistintos(): Promise<ViagensValoresDistintos> {
  const { data, error } = await (supabase as any).rpc("viagens_valores_distintos");
  if (error) throw error;
  return (data ?? { tipos_operacao: [], versoes: [], arquivos: [] }) as ViagensValoresDistintos;
}
