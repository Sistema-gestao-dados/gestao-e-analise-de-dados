-- Correção de segurança: essas 4 tabelas foram criadas concedendo acesso a
-- "anon" (visitante sem login) por engano — seguindo um padrão antigo do
-- projeto que já tinha sido abandonado em julho/2026 para as tabelas
-- principais (linhas, viagens, etc.). Este script aplica exatamente o
-- mesmo padrão de segurança que essas tabelas já usam: remove o acesso
-- anônimo e exige usuário autenticado.

DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'linha_empresa_estacao',
  'viagens_realizado',
  'historico_dia_tipos',
  'historico_reprogramacao'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- remove a política antiga, aberta pra qualquer um
    EXECUTE format('DROP POLICY IF EXISTS "public_all_%s" ON public.%I', t, t);
    -- remove o acesso do visitante sem login
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    -- garante que usuário logado continua com acesso normal
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    -- cria a política nova: só quem estiver logado
    EXECUTE format(
      'CREATE POLICY "auth_all_%s" ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
      t, t
    );
  END LOOP;
END $$;
