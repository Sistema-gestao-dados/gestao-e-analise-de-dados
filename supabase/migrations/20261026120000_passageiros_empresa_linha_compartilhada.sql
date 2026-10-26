-- Passageiros: Empresa/Grupo/Unidade da linha COMPARTILHADA (com exceção
-- por estação em `linha_empresa_estacao`, ex.: "07"/"07A" = Icaraí num
-- trecho, Tanguá noutro). A planilha DADOS PAX não tem estação, então quem
-- importa escolhe a qual empresa aquela linha da planilha pertence — e a
-- escolha fica gravada aqui. NULL = vale o cadastro da linha (`linhas`).
ALTER TABLE public.passageiros_diario
  ADD COLUMN IF NOT EXISTS empresa TEXT,
  ADD COLUMN IF NOT EXISTS grupo TEXT,
  ADD COLUMN IF NOT EXISTS unidade TEXT;

-- Acesso restrito: registro com Empresa/Grupo escolhidos vale pelo que foi
-- escolhido (a linha compartilhada aparece só pra empresa dona daquele
-- registro); sem escolha, continua valendo a linha do usuário.
DROP POLICY IF EXISTS "restringe_grupo_empresa_passageiros_diario" ON public.passageiros_diario;
CREATE POLICY "restringe_grupo_empresa_passageiros_diario" ON public.passageiros_diario
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT (SELECT public.acesso_usuario_restrito())
    OR (empresa IS NULL AND grupo IS NULL AND linha = ANY ((SELECT public.acesso_linhas_usuario())::text[]))
    OR grupo = ANY ((SELECT public.acesso_grupos_usuario())::text[])
    OR empresa = ANY ((SELECT public.acesso_empresas_usuario())::text[])
  )
  WITH CHECK (
    NOT (SELECT public.acesso_usuario_restrito())
    OR (empresa IS NULL AND grupo IS NULL AND linha = ANY ((SELECT public.acesso_linhas_usuario())::text[]))
    OR grupo = ANY ((SELECT public.acesso_grupos_usuario())::text[])
    OR empresa = ANY ((SELECT public.acesso_empresas_usuario())::text[])
  );
