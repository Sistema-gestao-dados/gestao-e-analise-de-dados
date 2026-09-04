-- A mesma linha pode também operar em Grupos diferentes por empresa (ex.:
-- linha "07" = Grupo Maua quando é viagem da Icaraí, Grupo Rio Ita quando é
-- da Tanguá). Adiciona essa segunda exceção na mesma tabela de estação,
-- opcional — se não preencher, o Grupo continua vindo do Cadastro de Linhas
-- normal (campo "Grupo", ex-"Ordem"), igual antes.
ALTER TABLE public.linha_empresa_estacao ADD COLUMN IF NOT EXISTS grupo TEXT;
