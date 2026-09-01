
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'linhas','viagens','parametro_km','parametro_multilinha',
  'projeto_ativo','classificacao_operacional','importacoes'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth_all_%s" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "auth_all_%s" ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
      t, t
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated;
