import type { ViagemLite } from "@/lib/resumo";
import { fetchAllPaginado } from "@/lib/fetch-paginado";

export async function fetchAllViagens(): Promise<ViagemLite[]> {
  return fetchAllPaginado<ViagemLite>(
    "viagens",
    "id,linha,tipo_operacao,tipo_servico,servico,carro,turno,versao_programacao,origem,destino,tipo_movimento,categoria_movimento,sentido,partida,chegada,tempo_viagem,arquivo,created_at",
  );
}

