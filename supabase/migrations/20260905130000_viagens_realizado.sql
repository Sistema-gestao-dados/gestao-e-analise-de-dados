-- Guarda o relatório "Gestão de Viagem" do Cittati (Previsto x Realizado),
-- já com partida, chegada, tempo de viagem e passageiros comparados. Uma
-- linha por trecho de viagem (Ida ou Volta), igual ao arquivo de origem.
-- Independente da tabela `viagens` (programado/FLITS/EasyBus) — é uma foto
-- fechada de um período já encerrado, sem cruzamento com a escala.
CREATE TABLE public.viagens_realizado (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo TEXT,
  empresa TEXT,
  linha TEXT NOT NULL,
  linha_raw TEXT,
  data DATE NOT NULL,
  numero TEXT,
  servico TEXT,
  turno TEXT,
  sentido TEXT, -- 'I' ou 'V'
  prefixo_raw TEXT,
  veiculo TEXT,
  motorista TEXT,
  terminal_inicial TEXT,
  terminal_final TEXT,
  prev_partida TEXT,   -- "HH:MM"
  real_partida TEXT,   -- "HH:MM" ou NULL = viagem perdida (nunca saiu)
  dif_partida INTEGER, -- minutos, real - previsto
  prev_chegada TEXT,
  real_chegada TEXT,   -- NULL (com partida preenchida) = viagem incompleta
  dif_chegada INTEGER,
  prev_tempo_viagem INTEGER, -- minutos
  real_tempo_viagem INTEGER,
  dif_tempo_viagem INTEGER,
  passageiros INTEGER,
  motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Calculada no código (não gerada pelo banco) para evitar a restrição de
  -- "immutability" do Postgres em funções de data/hora.
  dedupe_key TEXT NOT NULL
);

CREATE UNIQUE INDEX viagens_realizado_dedupe_key_uidx ON public.viagens_realizado (dedupe_key);

CREATE INDEX idx_viagens_realizado_data ON public.viagens_realizado(data);
CREATE INDEX idx_viagens_realizado_linha ON public.viagens_realizado(linha);
CREATE INDEX idx_viagens_realizado_empresa ON public.viagens_realizado(empresa);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.viagens_realizado TO anon, authenticated;
GRANT ALL ON public.viagens_realizado TO service_role;
ALTER TABLE public.viagens_realizado ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_viagens_realizado" ON public.viagens_realizado FOR ALL USING (true) WITH CHECK (true);
