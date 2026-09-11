-- Regras do acordo coletivo (confirmadas com o usuário em 11/09/2026):
-- valor_hora = salário ÷ horas_mensais_referencia
-- custo = valor_hora × [horas totais + horas_extra×(%he) + horas_noturnas×(%noturno)] × (1+%encargos)
-- Só administrador pode EDITAR (qualquer usuário logado pode ler, já que os
-- relatórios usam isso pra mostrar custo).
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS encargos_percentual NUMERIC(5,2) NOT NULL DEFAULT 46;
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS adicional_noturno_percentual NUMERIC(5,2) NOT NULL DEFAULT 20;
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS hora_extra_percentual NUMERIC(5,2) NOT NULL DEFAULT 50;
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS horas_mensais_referencia NUMERIC(6,2) NOT NULL DEFAULT 210;
-- Janela do adicional noturno, em minutos desde 00:00 (22:00=1320, 05:00=300)
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS noturno_inicio_min INTEGER NOT NULL DEFAULT 1320;
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS noturno_fim_min INTEGER NOT NULL DEFAULT 300;
-- Janela permitida pro início/fim do regime de TU, em minutos (04:00=240, 21:00=1260)
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS tu_inicio_minimo_min INTEGER NOT NULL DEFAULT 240;
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS tu_fim_maximo_min INTEGER NOT NULL DEFAULT 1260;

-- Endurece a escrita: só admin edita (leitura continua liberada pra todo
-- autenticado, pois os relatórios precisam ler pra calcular custo).
DROP POLICY IF EXISTS "auth_all_parametros_custo" ON public.parametros_custo;
CREATE POLICY "parametros_custo_select" ON public.parametros_custo
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "parametros_custo_update_admin" ON public.parametros_custo
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
