-- Parâmetro único (vale pra todas as empresas do grupo) usado pra calcular
-- custo de mão de obra nos relatórios: diária = salário mensal / 30, e
-- custo de um projeto/linha/grupo = número de Serviços (mesma contagem já
-- usada em "Serviços" nos relatórios: DIR T1+T2 = 2, TU = 1) × diária.
CREATE TABLE public.parametros_custo (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- linha única (singleton)
  salario_motorista_mensal NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.parametros_custo (id, salario_motorista_mensal) VALUES (1, 0);

GRANT SELECT, UPDATE ON public.parametros_custo TO authenticated;
GRANT ALL ON public.parametros_custo TO service_role;
ALTER TABLE public.parametros_custo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_parametros_custo" ON public.parametros_custo
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
