// Gerenciamento de "projeto ativo/vigente" por (linha, tipo_operacao).
// Regra: apenas UMA versão pode estar ativa por combinação (unique).
// Ativar um novo projeto substitui automaticamente o anterior (upsert).

import { supabase } from "@/integrations/supabase/client";
import type { ViagemLite } from "@/lib/resumo";
import { fetchAllPaginado } from "@/lib/fetch-paginado";

export type ProjetoAtivo = {
  id: string;
  linha: string;
  tipo_operacao: string;
  versao_programacao: string;
};

export async function fetchProjetosAtivos(): Promise<ProjetoAtivo[]> {
  return fetchAllPaginado<ProjetoAtivo>("projeto_ativo", "id,linha,tipo_operacao,versao_programacao");
}

/** Escapa `%`, `_` e `\` pra usar um texto livre com segurança como padrão
 *  de `.ilike()` — sem isso, um dia tipo custom com esses caracteres no
 *  nome pode casar com linhas de outro grupo por engano. */
function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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

/** Retorna todas as linhas do mesmo grupo/tipo_dia, incluindo a própria.
 *  Usa comparação sem diferenciar maiúsculas/minúsculas (ilike) pra não
 *  quebrar silenciosamente se o dia tipo vier com grafia levemente
 *  diferente entre importações (já causou esse problema antes). */
async function linhasDoGrupo(linha: string, tipo_operacao: string): Promise<string[]> {
  const padrao = escapeIlike(tipo_operacao);
  const { data: g, error: e1 } = await (supabase as any)
    .from("parametro_multilinha")
    .select("grupo_du")
    .eq("linha", linha)
    .ilike("tipo_dia", padrao);
  if (e1) throw e1;
  const grupos = Array.from(new Set((g ?? []).map((r: any) => r.grupo_du).filter(Boolean)));
  if (!grupos.length) return [linha];
  const { data: irmas, error: e2 } = await (supabase as any)
    .from("parametro_multilinha")
    .select("linha")
    .in("grupo_du", grupos)
    .ilike("tipo_dia", padrao);
  if (e2) throw e2;
  const set = new Set<string>([linha, ...((irmas ?? []).map((r: any) => r.linha))]);
  return Array.from(set);
}

/** Ativa em lote todos os (linha, tipo_operacao) presentes na versão indicada,
 *  substituindo qualquer ativação anterior dessas combinações. Também propaga
 *  para as linhas do mesmo grupo (parametro_multilinha), igual ao ativarProjeto. */
export async function ativarVersao(versao_programacao: string) {
  const { data, error } = await (supabase as any)
    .from("viagens")
    .select("linha,tipo_operacao")
    .eq("versao_programacao", versao_programacao);
  if (error) throw error;
  const set = new Set<string>();
  const combos: { linha: string; tipo_operacao: string }[] = [];
  for (const v of (data ?? []) as any[]) {
    const key = `${v.linha}||${v.tipo_operacao ?? ""}`;
    if (set.has(key) || !v.tipo_operacao) continue;
    set.add(key);
    combos.push({ linha: v.linha, tipo_operacao: v.tipo_operacao });
  }
  if (!combos.length) return { count: 0 };

  // Expande cada combinação pras linhas irmãs do mesmo grupo/tipo_dia.
  const payloadSet = new Set<string>();
  const payload: any[] = [];
  for (const c of combos) {
    const linhasGrupo = await linhasDoGrupo(c.linha, c.tipo_operacao);
    for (const l of linhasGrupo) {
      const key = `${l}||${c.tipo_operacao}`;
      if (payloadSet.has(key)) continue;
      payloadSet.add(key);
      payload.push({ linha: l, tipo_operacao: c.tipo_operacao, versao_programacao });
    }
  }

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
 *  combinação (linha, tipo_operacao). Combinação sem NENHUM projeto ativo
 *  fica de fora (não aparece) — não "mostra tudo". */
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
