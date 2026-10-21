-- Acesso restrito por Grupo/Empresa — cadastros (continuação da Fase 2, que
-- só cobria `viagens`). Usuário restrito passa a VER e GRAVAR só o cadastro
-- das linhas do próprio Grupo/Empresa em:
--   linhas, parametro_km, parametro_multilinha, linha_empresa_estacao.
--
-- "Linha do usuário" = mesma regra do resto do sistema (src/lib/acesso.ts,
-- resolver_grupo_viagem/resolver_empresa_viagem): Grupo (linhas.ordem) ou
-- Empresa da linha liberados, OU alguma exceção por estação daquela linha
-- com Grupo/Empresa liberado (linha compartilhada, ex. "07").
--
-- Desempenho (ver incidentes de 13/out no CLAUDE.md): nada é calculado por
-- linha da tabela. As listas do usuário (grupos, empresas, linhas) saem de
-- funções chamadas UMA vez por consulta — `(SELECT f())` vira InitPlan — e
-- cada linha só faz `col = ANY(array)`. As funções são SECURITY DEFINER pra
-- ler o cadastro inteiro sem cair na própria política (recursão) e sem
-- depender do que o usuário enxerga.
--
-- Admin e usuário sem `acesso_restrito`: nada muda.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Funções de acesso do usuário logado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acesso_usuario_restrito()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.has_role(auth.uid(), 'admin')
     AND coalesce((SELECT acesso_restrito FROM public.profiles WHERE user_id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.acesso_grupos_usuario()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(valor), '{}') FROM public.user_data_access
  WHERE user_id = auth.uid() AND tipo = 'grupo';
$$;

CREATE OR REPLACE FUNCTION public.acesso_empresas_usuario()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(valor), '{}') FROM public.user_data_access
  WHERE user_id = auth.uid() AND tipo = 'empresa';
$$;

-- Linhas em que o usuário opera por exceção de estação (linha compartilhada).
CREATE OR REPLACE FUNCTION public.acesso_linhas_por_excecao()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT linha), '{}') FROM public.linha_empresa_estacao
  WHERE grupo = ANY (public.acesso_grupos_usuario())
     OR empresa = ANY (public.acesso_empresas_usuario());
$$;

-- Todas as linhas do usuário: Grupo/Empresa próprios da linha + exceções.
CREATE OR REPLACE FUNCTION public.acesso_linhas_usuario()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT l), '{}') FROM (
    SELECT linha AS l FROM public.linhas
    WHERE ordem = ANY (public.acesso_grupos_usuario())
       OR empresa = ANY (public.acesso_empresas_usuario())
    UNION
    SELECT unnest(public.acesso_linhas_por_excecao())
  ) s;
$$;

REVOKE ALL ON FUNCTION public.acesso_usuario_restrito() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acesso_grupos_usuario() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acesso_empresas_usuario() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acesso_linhas_por_excecao() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acesso_linhas_usuario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acesso_usuario_restrito() TO authenticated;
GRANT EXECUTE ON FUNCTION public.acesso_grupos_usuario() TO authenticated;
GRANT EXECUTE ON FUNCTION public.acesso_empresas_usuario() TO authenticated;
GRANT EXECUTE ON FUNCTION public.acesso_linhas_por_excecao() TO authenticated;
GRANT EXECUTE ON FUNCTION public.acesso_linhas_usuario() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Políticas RESTRICTIVE (só estreitam o "auth_all_*" que já existe)
-- ---------------------------------------------------------------------------

-- linhas: vê as linhas dele. Gravar: o Grupo/Empresa da linha (como fica
-- DEPOIS) precisa ser dele, ou a linha ser dele por exceção de estação —
-- impede criar linha em outro grupo e "passar" uma linha dele pra outro.
DROP POLICY IF EXISTS "restringe_grupo_empresa_linhas" ON public.linhas;
CREATE POLICY "restringe_grupo_empresa_linhas" ON public.linhas
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT (SELECT public.acesso_usuario_restrito())
    OR linha = ANY ((SELECT public.acesso_linhas_usuario())::text[])
  )
  WITH CHECK (
    NOT (SELECT public.acesso_usuario_restrito())
    OR ordem = ANY ((SELECT public.acesso_grupos_usuario())::text[])
    OR empresa = ANY ((SELECT public.acesso_empresas_usuario())::text[])
    OR linha = ANY ((SELECT public.acesso_linhas_por_excecao())::text[])
  );

DROP POLICY IF EXISTS "restringe_grupo_empresa_parametro_km" ON public.parametro_km;
CREATE POLICY "restringe_grupo_empresa_parametro_km" ON public.parametro_km
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT (SELECT public.acesso_usuario_restrito())
    OR linha = ANY ((SELECT public.acesso_linhas_usuario())::text[])
  )
  WITH CHECK (
    NOT (SELECT public.acesso_usuario_restrito())
    OR linha = ANY ((SELECT public.acesso_linhas_usuario())::text[])
  );

DROP POLICY IF EXISTS "restringe_grupo_empresa_parametro_multilinha" ON public.parametro_multilinha;
CREATE POLICY "restringe_grupo_empresa_parametro_multilinha" ON public.parametro_multilinha
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT (SELECT public.acesso_usuario_restrito())
    OR linha = ANY ((SELECT public.acesso_linhas_usuario())::text[])
  )
  WITH CHECK (
    NOT (SELECT public.acesso_usuario_restrito())
    OR linha = ANY ((SELECT public.acesso_linhas_usuario())::text[])
  );

-- linha_empresa_estacao: a exceção DECIDE o Grupo/Empresa das viagens (e
-- portanto quem vê o quê) — usuário restrito só vê/grava exceção do próprio
-- Grupo/Empresa, e só cria em linha que já é dele.
DROP POLICY IF EXISTS "restringe_grupo_empresa_linha_empresa_estacao" ON public.linha_empresa_estacao;
CREATE POLICY "restringe_grupo_empresa_linha_empresa_estacao" ON public.linha_empresa_estacao
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT (SELECT public.acesso_usuario_restrito())
    OR grupo = ANY ((SELECT public.acesso_grupos_usuario())::text[])
    OR empresa = ANY ((SELECT public.acesso_empresas_usuario())::text[])
  )
  WITH CHECK (
    NOT (SELECT public.acesso_usuario_restrito())
    OR (
      (grupo = ANY ((SELECT public.acesso_grupos_usuario())::text[]) OR empresa = ANY ((SELECT public.acesso_empresas_usuario())::text[]))
      AND linha = ANY ((SELECT public.acesso_linhas_usuario())::text[])
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Gatilhos de grupo_resolvido/empresa_resolvida em `viagens`
-- ---------------------------------------------------------------------------
-- Antes, rodavam com as permissões de quem importa/edita. Com o cadastro
-- agora filtrado por usuário, um usuário restrito deixaria de enxergar a
-- exceção de estação de OUTRA empresa na mesma linha — e a viagem seria
-- gravada com o Grupo/Empresa errado (o dele, em vez do da outra empresa).
-- SECURITY DEFINER faz a resolução sempre olhar o cadastro inteiro.
ALTER FUNCTION public.set_grupo_empresa_viagem() SECURITY DEFINER;
ALTER FUNCTION public.recompute_grupo_empresa_viagens_por_linha(text) SECURITY DEFINER;
-- Os gatilhos que chamam o recálculo também rodam como dono: senão quem
-- edita uma linha precisaria de EXECUTE no recálculo (revogado abaixo), e o
-- UPDATE em `viagens` cairia na política de quem editou.
ALTER FUNCTION public.trg_recompute_grupo_empresa_linhas() SECURITY DEFINER;
ALTER FUNCTION public.trg_recompute_grupo_empresa_lee() SECURITY DEFINER;
-- Recalcula viagens de uma linha inteira: só via gatilho, nunca chamada
-- direto pela API.
REVOKE ALL ON FUNCTION public.recompute_grupo_empresa_viagens_por_linha(text) FROM PUBLIC, anon, authenticated;

COMMIT;
