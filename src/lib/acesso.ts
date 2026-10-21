// Acesso restrito por Grupo/Empresa (ver CLAUDE.md, "Acesso restrito por
// Grupo/Empresa") do lado do navegador — pros pontos que o RLS de `viagens`
// NÃO cobre: cadastros (linhas, KM, grupos, empresa por estação, siglas),
// versão ativa e dia tipo são tabelas compartilhadas entre todos os grupos.
//
// Uma linha "é do usuário" pela MESMA regra que decide o grupo/empresa de
// uma viagem no banco (resolver_grupo_viagem/resolver_empresa_viagem):
// Grupo (linhas.ordem) ou Empresa da linha liberados, OU alguma exceção por
// estação daquela linha (linha_empresa_estacao) com Grupo/Empresa liberado —
// linha compartilhada entre empresas (ex.: "07") é editável por qualquer
// uma das que operam nela.
//
// Usuário sem restrição (ou admin) pode tudo — igual ao RLS.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { fetchLinhas, fetchEmpresaEstacao, type Linha, type LinhaEmpresaEstacao } from "@/lib/data";
import { buildEmpresaOverrideMap, resolveEmpresaViagem, resolveGrupoViagem } from "@/lib/empresa-estacao";

export type AcessoDados = {
  /** true = usuário com acesso restrito (e não admin). */
  restrito: boolean;
  /** Grupo/Empresa informados estão liberados pro usuário? */
  podeValores: (grupo: string | null | undefined, empresa: string | null | undefined) => boolean;
  /** A linha (código) é do grupo/empresa do usuário? Linha fora do cadastro = não. */
  podeLinha: (linha: string | null | undefined) => boolean;
  /** A viagem cai no Grupo/Empresa do usuário? Mesma resolução do banco
   *  (grupo_resolvido/empresa_resolvida): exceção por estação de origem/
   *  destino, senão o cadastro da linha. É o que a política de `viagens`
   *  checa ao gravar — viagem que dá false aqui o banco recusa. */
  podeViagem: (v: { linha: string; origem?: string | null; destino?: string | null }) => boolean;
};

export const ACESSO_LIVRE: AcessoDados = { restrito: false, podeValores: () => true, podeLinha: () => true, podeViagem: () => true };

export function buildAcesso(
  user: { acessoRestrito: boolean; gruposPermitidos: Set<string>; empresasPermitidos: Set<string> } | null,
  isAdmin: boolean,
  linhas: Linha[],
  empresaEstacao: LinhaEmpresaEstacao[],
): AcessoDados {
  if (!user || isAdmin || !user.acessoRestrito) return ACESSO_LIVRE;
  const podeValores = (grupo: string | null | undefined, empresa: string | null | undefined) =>
    (!!grupo && user.gruposPermitidos.has(grupo)) || (!!empresa && user.empresasPermitidos.has(empresa));
  const permitidas = new Set<string>();
  for (const l of linhas) if (podeValores(l.ordem, l.empresa)) permitidas.add(l.linha);
  for (const e of empresaEstacao) if (podeValores(e.grupo, e.empresa)) permitidas.add(e.linha);
  const linhaMap = new Map(linhas.map((l) => [l.linha, l]));
  const overrideMap = buildEmpresaOverrideMap(empresaEstacao);
  return {
    restrito: true,
    podeValores,
    podeLinha: (linha) => !!linha && permitidas.has(linha),
    podeViagem: (v) => podeValores(resolveGrupoViagem(v, linhaMap, overrideMap), resolveEmpresaViagem(v, linhaMap, overrideMap)),
  };
}

/** Hook pronto pras telas: reaproveita o cache de "linhas"/"empresa-estacao".
 *  `carregando` = ainda não dá pra decidir (não libere gravação enquanto true). */
export function useAcessoDados(): AcessoDados & { carregando: boolean } {
  const { user, isAdmin } = useAuth();
  const restrito = !!user?.acessoRestrito && !isAdmin;
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas, enabled: restrito });
  const eeQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao, enabled: restrito });
  const acesso = useMemo(
    () => buildAcesso(user, isAdmin, linhasQ.data ?? [], eeQ.data ?? []),
    [user, isAdmin, linhasQ.data, eeQ.data],
  );
  return { ...acesso, carregando: restrito && (linhasQ.isLoading || eeQ.isLoading) };
}

/** Recorte do cadastro pra montar OPÇÕES de filtro (Empresa, Unidade,
 *  Grupo, Categoria, Grupo de Linha, Linha) sem mostrar valores de outro
 *  Grupo/Empresa pro usuário restrito. Só pra listas de opção — os cálculos
 *  continuam usando o cadastro inteiro (precisam dele pra resolver
 *  Grupo/Empresa/Unidade de cada viagem certo).
 *   - `linhasDonas`: linhas cujo Grupo/Empresa PRÓPRIO é liberado — fonte de
 *     Empresa/Unidade/Grupo (numa linha compartilhada que o usuário só opera
 *     por exceção de estação, a empresa "dona" da linha é a outra).
 *   - `linhas`: toda linha que o usuário opera (inclui as por exceção) —
 *     fonte de Linha/Categoria.
 *   - `empresaEstacao`: só exceções do Grupo/Empresa liberado.
 *   - `multi`: Grupo de Linha só das linhas que ele opera. */
export function cadastroParaOpcoes<L extends Linha, E extends { linha: string; empresa: string; grupo: string | null }, M extends { linha: string }>(
  acesso: AcessoDados,
  linhas: L[],
  empresaEstacao: E[],
  multi: M[],
): { linhas: L[]; linhasDonas: L[]; empresaEstacao: E[]; multi: M[] } {
  if (!acesso.restrito) return { linhas, linhasDonas: linhas, empresaEstacao, multi };
  return {
    linhas: linhas.filter((l) => acesso.podeLinha(l.linha)),
    linhasDonas: linhas.filter((l) => acesso.podeValores(l.ordem, l.empresa)),
    empresaEstacao: empresaEstacao.filter((e) => acesso.podeValores(e.grupo, e.empresa)),
    multi: multi.filter((m) => acesso.podeLinha(m.linha)),
  };
}

type GrupoEmpresa ={ ordem?: string | null; empresa?: string | null };

/** Pode gravar o cadastro da linha `codigo`? `antes` = cadastro atual
 *  (undefined = linha nova), `depois` = como vai ficar. Devolve o motivo
 *  do bloqueio, ou null se pode. Regras pro usuário restrito:
 *   - linha nova só se o Grupo/Empresa dela for liberado pra ele;
 *   - linha existente só se for dele (podeLinha);
 *   - não pode "passar" uma linha do grupo dele pra outro grupo/empresa. */
export function motivoBloqueioLinha(
  acesso: AcessoDados,
  codigo: string,
  antes: GrupoEmpresa | undefined,
  depois: GrupoEmpresa,
): string | null {
  if (!acesso.restrito) return null;
  if (!antes) {
    return acesso.podeValores(depois.ordem, depois.empresa)
      ? null
      : `Linha ${codigo}: nova linha precisa ter um Grupo/Empresa liberado pro seu usuário.`;
  }
  if (!acesso.podeLinha(codigo)) return `Linha ${codigo}: pertence a outro Grupo/Empresa.`;
  if (acesso.podeValores(antes.ordem, antes.empresa) && !acesso.podeValores(depois.ordem, depois.empresa)) {
    return `Linha ${codigo}: não é possível passar a linha pra um Grupo/Empresa fora do seu acesso.`;
  }
  return null;
}

/** Mensagem padrão pra quando a ação é bloqueada. */
export const MSG_SEM_ACESSO = "Seu usuário tem acesso restrito por Grupo/Empresa — essa ação afeta dados de outros grupos.";
