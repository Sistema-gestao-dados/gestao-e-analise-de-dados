-- Igual ao Grupo: a Unidade também pode variar por empresa numa linha
-- operada por mais de uma (ex.: linha "07" = Unidade Icaraí em alguns
-- trechos, Unidade Expresso Tanguá em outros). Opcional — se não
-- preencher, a Unidade continua vindo do Cadastro de Linhas normal.
ALTER TABLE public.linha_empresa_estacao ADD COLUMN IF NOT EXISTS unidade TEXT;
