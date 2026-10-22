-- Liga/desliga em /parametros-custo: somar ou não a antecipação e a
-- prestação de contas (linhas.antec_t1..prest_t3) na jornada de trabalho.
-- Ligado (padrão) = comportamento de sempre: jornada do turno vai de
-- (1ª partida − antecipação) a (última chegada + prestação). Desligado =
-- só da 1ª partida à última chegada. Vale pra jornada, intra-jornada,
-- hora extra e custo de mão de obra em todas as telas.
ALTER TABLE public.parametros_custo
  ADD COLUMN IF NOT EXISTS somar_antec_prest BOOLEAN NOT NULL DEFAULT true;
