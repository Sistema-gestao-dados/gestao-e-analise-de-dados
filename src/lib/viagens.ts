import { supabase } from "@/integrations/supabase/client";
import type { ViagemLite } from "@/lib/resumo";

export async function fetchAllViagens(): Promise<ViagemLite[]> {
  const all: ViagemLite[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await (supabase as any)
      .from("viagens")
      .select("id,linha,tipo_operacao,tipo_servico,servico,carro,turno,versao_programacao,origem,destino,tipo_movimento,categoria_movimento,sentido,partida,chegada,tempo_viagem,arquivo,created_at")
      .range(from, from + 999);
    if (error) throw error;
    const chunk = (data ?? []) as ViagemLite[];
    all.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return all;
}
