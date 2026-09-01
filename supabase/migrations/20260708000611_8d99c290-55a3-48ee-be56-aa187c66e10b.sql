
-- Adiciona coluna gerada `carro` = servico (regra: carro é o número do serviço)
-- Usado para calcular frota como veículos únicos por (linha, carro), independente de turno/tipo.
ALTER TABLE public.viagens
  ADD COLUMN IF NOT EXISTS carro text GENERATED ALWAYS AS (servico) STORED;

CREATE INDEX IF NOT EXISTS idx_viagens_linha_carro ON public.viagens (linha, carro);
CREATE INDEX IF NOT EXISTS idx_viagens_versao_carro ON public.viagens (versao_programacao, carro);
