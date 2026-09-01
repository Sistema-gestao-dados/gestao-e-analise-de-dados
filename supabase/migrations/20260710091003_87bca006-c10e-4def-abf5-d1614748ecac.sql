DROP POLICY IF EXISTS "Autenticados podem gerenciar projeto_ativo" ON public.projeto_ativo;
CREATE POLICY "public_all_projeto_ativo" ON public.projeto_ativo FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projeto_ativo TO anon, authenticated;