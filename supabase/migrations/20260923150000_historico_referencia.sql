-- Histórico de Reprogramação: campo "Referência" (livre — nº do ofício,
-- protocolo, etc.), exibido entre "Dia tipo" e "Data de solicitação".
ALTER TABLE public.historico_reprogramacao ADD COLUMN referencia TEXT;
