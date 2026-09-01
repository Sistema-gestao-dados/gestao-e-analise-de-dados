
CREATE TABLE public.viagens (
  id uuid not null default gen_random_uuid() primary key,
  linha text not null,
  tipo_operacao text,
  versao_programacao text,
  tipo_servico text,
  servico text,
  turno text,
  origem text,
  destino text,
  tipo_movimento text,
  categoria_movimento text,
  sentido text,
  partida text,
  chegada text,
  tempo_viagem text,
  arquivo text,
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.viagens TO anon, authenticated;
GRANT ALL ON public.viagens TO service_role;

ALTER TABLE public.viagens ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_all_viagens ON public.viagens FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX viagens_linha_idx ON public.viagens (linha);
CREATE INDEX viagens_arquivo_idx ON public.viagens (arquivo);
CREATE INDEX viagens_tipo_op_idx ON public.viagens (tipo_operacao);
