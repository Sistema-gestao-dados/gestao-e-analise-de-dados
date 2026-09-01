// Gerenciamento de "projeto ativo/vigente" por (linha, tipo_operacao).
// Regra: apenas UMA versão pode estar ativa por combinação (unique).
// Ativar um novo projeto substitui automaticamente o anterior (upsert).

import { supabase } from "@/integrations/supabase/client";
import type { ViagemLite } from "@/lib/resumo";

export type ProjetoAtivo = {
  id: string;
  linha: string;
  tipo_operacao: string;
  versao_programacao: string;
};

export async function fetchProjetosAtivos(): Promise<ProjetoAtivo[]> {
  const { data, error } = await supabase.from("projeto_ativo").select("id,linha,tipo_operacao,versao_programacao");
  if (error) throw error;
  return (data ?? []) as ProjetoAtivo[];
}

/** Ativa (linha, tipo_operacao, versao) — como o unique é (linha, tipo_operacao),
 *  upsert desativa qualquer versão anterior para a mesma combinação.
 *  Se a linha pertence a um grupo (parametro_multilinha) para o mesmo tipo_operacao,
 *  ativa a mesma versão para todas as linhas do grupo. */
export async function ativarProjeto(linha: string, tipo_operacao: string, versao_programacao: string) {
  const linhas = await linhasDoGrupo(linha, tipo_operacao);
  const payload = linhas.map((l) => ({ linha: l, tipo_operacao, versao_programacao }));
  const { error } = await supabase
    .from("projeto_ativo")
    .upsert(payload, { onConflict: "linha,tipo_operacao" });
  if (error) throw error;
}

/** Retorna todas as linhas do mesmo grupo/tipo_dia, incluindo a própria. */
async function linhasDoGrupo(linha: string, tipo_operacao: string): Promise<string[]> {
  const { data: g } = await (supabase as any)
    .from("parametro_multilinha")
    .select("grupo_du")
    .eq("linha", linha)
    .eq("tipo_dia", tipo_operacao);
  const grupos = Array.from(new Set((g ?? []).map((r: any) => r.grupo_du).filter(Boolean)));
  if (!grupos.length) return [linha];
  const { data: irmas } = await (supabase as any)
    .from("parametro_multilinha")
    .select("linha")
    .in("grupo_du", grupos)
    .eq("tipo_dia", tipo_operacao);
  const set = new Set<string>([linha, ...((irmas ?? []).map((r: any) => r.linha))]);
  return Array.from(set);
}

/** Ativa em lote todos os (linha, tipo_operacao) presentes na versão indicada,
 *  substituindo qualquer ativação anterior dessas combinações. */
export async function ativarVersao(versao_programacao: string) {
  const { data, error } = await (supabase as any)
    .from("viagens")
    .select("linha,tipo_operacao")
    .eq("versao_programacao", versao_programacao);
  if (error) throw error;
  const set = new Set<string>();
  const payload: any[] = [];
  for (const v of (data ?? []) as any[]) {
    const key = `${v.linha}||${v.tipo_operacao ?? ""}`;
    if (set.has(key) || !v.tipo_operacao) continue;
    set.add(key);
    payload.push({ linha: v.linha, tipo_operacao: v.tipo_operacao, versao_programacao });
  }
  if (!payload.length) return { count: 0 };
  const chunk = 200;
  for (let i = 0; i < payload.length; i += chunk) {
    const { error: e } = await supabase
      .from("projeto_ativo")
      .upsert(payload.slice(i, i + chunk), { onConflict: "linha,tipo_operacao" });
    if (e) throw e;
  }
  return { count: payload.length };
}

export async function desativarProjeto(linha: string, tipo_operacao: string) {
  const { error } = await supabase
    .from("projeto_ativo")
    .delete()
    .eq("linha", linha)
    .eq("tipo_operacao", tipo_operacao);
  if (error) throw error;
}

/** Filtra viagens mantendo apenas as pertencentes ao projeto ativo de cada
 *  combinação (linha, tipo_operacao). Combinações sem projeto ativo permanecem
 *  inalteradas (mostra tudo). */
export function filterViagensAtivas(viagens: ViagemLite[], ativos: ProjetoAtivo[]): ViagemLite[] {
  if (!ativos.length) return [];
  const map = new Map<string, string>();
  for (const a of ativos) map.set(`${a.linha}||${a.tipo_operacao}`, a.versao_programacao);
  return viagens.filter((v) => {
    const key = `${v.linha}||${v.tipo_operacao ?? ""}`;
    const versaoAtiva = map.get(key);
    if (!versaoAtiva) return false;
    return v.versao_programacao === versaoAtiva;
  });
}
