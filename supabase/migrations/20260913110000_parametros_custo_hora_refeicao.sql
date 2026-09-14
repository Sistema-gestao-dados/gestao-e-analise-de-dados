-- Hora refeição: valor fixo por serviço/dia (não é percentual, é um valor
-- em R$ direto), somado ao custo de cada serviço independente de quantas
-- horas ele trabalhou. Vale pra DIR e TU igual (confirmado com o usuário:
-- 39 serviços × R$7,57 = R$295,23, batendo com o total de Serviços do
-- grupo, não só os TU).
ALTER TABLE public.parametros_custo ADD COLUMN IF NOT EXISTS valor_hora_refeicao NUMERIC(10,2) NOT NULL DEFAULT 0;
