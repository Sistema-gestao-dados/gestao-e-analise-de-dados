-- Fase 2 do isolamento por Grupo/Empresa: aplica de verdade via RLS em
-- `viagens`. Desenhado pra ser IMPOSSÍVEL de travar o acesso de quem não
-- optou por isso: a trava só entra em vigor pra quem tem
-- profiles.acesso_restrito = true (ninguém hoje) E tem pelo menos um
-- escopo concedido em user_data_access. Pra todo o resto (literalmente
-- todo usuário existente agora), o comportamento não muda em nada.
--
-- Efeito colateral automático e desejado: a RPC viagens_valores_distintos
-- (dropdown Dia Tipo/Versão/Arquivo da tela /viagens) é SECURITY INVOKER —
-- ela respeita essa mesma RLS sozinha, sem precisar mexer em nenhum
-- código de tela. Um usuário restrito já deixa de ver Dia Tipo de outro
-- grupo automaticamente.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Resolve o Grupo ("GRUPO Maué"/"Rio Ita"/"Coesa", igual ao filtro dos
-- relatórios) de uma viagem: prioriza a exceção por estação
-- (linha_empresa_estacao, batendo por ORIGEM e só depois por DESTINO —
-- usa a 1ª que achar, mesmo que o grupo dela esteja vazio, sem tentar a
-- outra), senão cai pro cadastro normal da linha (linhas.ordem). Espelha
-- EXATAMENTE resolveGrupoViagem() em src/lib/empresa-estacao.ts —
-- qualquer mudança lá precisa ser replicada aqui também.
CREATE OR REPLACE FUNCTION public.resolver_grupo_viagem(p_linha text, p_origem text, p_destino text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH override AS (
    (SELECT grupo FROM public.linha_empresa_estacao
     WHERE linha = p_linha AND p_origem IS NOT NULL AND p_origem <> ''
       AND extensions.unaccent(upper(trim(estacao))) = extensions.unaccent(upper(trim(p_origem)))
     LIMIT 1)
    UNION ALL
    (SELECT grupo FROM public.linha_empresa_estacao
     WHERE linha = p_linha AND p_destino IS NOT NULL AND p_destino <> ''
       AND extensions.unaccent(upper(trim(estacao))) = extensions.unaccent(upper(trim(p_destino)))
       AND NOT EXISTS (
         SELECT 1 FROM public.linha_empresa_estacao
         WHERE linha = p_linha AND p_origem IS NOT NULL AND p_origem <> ''
           AND extensions.unaccent(upper(trim(estacao))) = extensions.unaccent(upper(trim(p_origem)))
       )
     LIMIT 1)
  )
  SELECT coalesce((SELECT grupo FROM override LIMIT 1), (SELECT ordem FROM public.linhas WHERE linha = p_linha));
$$;

-- Mesma ideia, mas pra Empresa — espelha resolveEmpresaViagem().
CREATE OR REPLACE FUNCTION public.resolver_empresa_viagem(p_linha text, p_origem text, p_destino text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH override AS (
    (SELECT empresa FROM public.linha_empresa_estacao
     WHERE linha = p_linha AND p_origem IS NOT NULL AND p_origem <> ''
       AND extensions.unaccent(upper(trim(estacao))) = extensions.unaccent(upper(trim(p_origem)))
     LIMIT 1)
    UNION ALL
    (SELECT empresa FROM public.linha_empresa_estacao
     WHERE linha = p_linha AND p_destino IS NOT NULL AND p_destino <> ''
       AND extensions.unaccent(upper(trim(estacao))) = extensions.unaccent(upper(trim(p_destino)))
       AND NOT EXISTS (
         SELECT 1 FROM public.linha_empresa_estacao
         WHERE linha = p_linha AND p_origem IS NOT NULL AND p_origem <> ''
           AND extensions.unaccent(upper(trim(estacao))) = extensions.unaccent(upper(trim(p_origem)))
       )
     LIMIT 1)
  )
  SELECT coalesce((SELECT empresa FROM override LIMIT 1), (SELECT empresa FROM public.linhas WHERE linha = p_linha));
$$;

-- Decide se um usuário pode ver/gravar uma viagem específica.
-- Ordem de curto-circuito (a mais barata primeiro):
--   1) admin sempre vê tudo;
--   2) quem não está com acesso_restrito ligado vê tudo (hoje, todo mundo);
--   3) restrito: só se o Grupo OU a Empresa resolvidos da viagem estiverem
--      entre os escopos concedidos a esse usuário em user_data_access.
CREATE OR REPLACE FUNCTION public.usuario_tem_acesso_viagem(p_user_id uuid, p_linha text, p_origem text, p_destino text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(p_user_id, 'admin')
    OR NOT coalesce((SELECT acesso_restrito FROM public.profiles WHERE user_id = p_user_id), false)
    OR EXISTS (
      SELECT 1 FROM public.user_data_access uda
      WHERE uda.user_id = p_user_id
        AND (
          (uda.tipo = 'grupo' AND uda.valor = public.resolver_grupo_viagem(p_linha, p_origem, p_destino))
          OR (uda.tipo = 'empresa' AND uda.valor = public.resolver_empresa_viagem(p_linha, p_origem, p_destino))
        )
    );
$$;

-- As 3 funções acima são SECURITY DEFINER (mesmo padrão de has_role: evita
-- qualquer interação com RLS de linhas/linha_empresa_estacao/profiles/
-- user_data_access, inclusive se essas políticas mudarem no futuro) — por
-- isso a execução é restrita a quem já está autenticado, igual has_role.
REVOKE ALL ON FUNCTION public.resolver_grupo_viagem(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_grupo_viagem(text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolver_empresa_viagem(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_empresa_viagem(text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.usuario_tem_acesso_viagem(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuario_tem_acesso_viagem(uuid, text, text, text) TO authenticated, service_role;

-- `viagens` ainda estava com a política antiga (acesso de "anon", nunca
-- migrada pro padrão "só autenticado" que as outras tabelas já usam desde
-- 09/set — ver fecha_acesso_anonimo_tabelas_novas). Fecha isso aqui junto,
-- já que sem isso a restrição de Grupo/Empresa não vale de nada (dava pra
-- contornar direto pela API sem login).
DROP POLICY IF EXISTS "public_all_viagens" ON public.viagens;
REVOKE ALL ON public.viagens FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.viagens TO authenticated;

DROP POLICY IF EXISTS "auth_all_viagens" ON public.viagens;
CREATE POLICY "auth_all_viagens" ON public.viagens
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Política RESTRICTIVE: é "E" com a de cima, nunca "OU" — só consegue
-- ESTREITAR o que auth_all_viagens já libera, nunca ampliar. Pra qualquer
-- usuário não-restrito (literalmente todo mundo até o admin mudar algo em
-- /usuarios), usuario_tem_acesso_viagem() resolve TRUE na 2ª condição
-- (NOT acesso_restrito) sem nem chegar a calcular Grupo/Empresa — zero
-- mudança de comportamento pra ninguém até aí.
DROP POLICY IF EXISTS "restringe_grupo_empresa_viagens" ON public.viagens;
CREATE POLICY "restringe_grupo_empresa_viagens" ON public.viagens
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.usuario_tem_acesso_viagem(auth.uid(), linha, origem, destino))
  WITH CHECK (public.usuario_tem_acesso_viagem(auth.uid(), linha, origem, destino));
