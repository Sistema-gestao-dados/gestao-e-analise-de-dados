-- Faltava política de INSERT nessa tabela — só existia SELECT e UPDATE.
-- Sem isso, o upsert usado pra corrigir o bug "salário zera em outro
-- local" falharia bloqueado pelo RLS exatamente no caso que ele deveria
-- corrigir (linha id=1 ausente, upsert precisando inserir).
CREATE POLICY "parametros_custo_insert_admin" ON public.parametros_custo
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
