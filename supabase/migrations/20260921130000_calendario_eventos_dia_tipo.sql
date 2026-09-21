-- Filtro de dia da semana por evento do calendário: quando preenchido,
-- restringe o período (data_inicio..data_fim) só aos dias daquele tipo —
-- ex. período 01 a 30/09 + "Dias úteis" = marca só segunda a sexta dentro
-- do período, ignorando sábados e domingos. NULL = todos os dias do período.
ALTER TABLE public.calendario_eventos ADD COLUMN IF NOT EXISTS dia_tipo TEXT;
