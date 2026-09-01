-- ============ CLASSIFICACAO_OPERACIONAL ============
-- Esta tabela existia no banco original (criada fora do histórico de
-- migrations, direto no editor do Lovable Cloud) mas nunca tinha sido
-- exportada como migration. Recriada aqui a partir do schema real
-- (src/integrations/supabase/types.ts) para que o projeto rode do zero
-- em qualquer Supabase novo.
CREATE TABLE public.classificacao_operacional (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  servico TEXT NOT NULL,
  tipo_operacao TEXT NOT NULL,
  versao_programacao TEXT NOT NULL,
  classificacao TEXT NOT NULL,
  linha_dominante TEXT,
  num_turnos INTEGER NOT NULL DEFAULT 0,
  turnos TEXT[] NOT NULL DEFAULT '{}',
  num_motoristas INTEGER NOT NULL DEFAULT 0,
  total_viagens INTEGER NOT NULL DEFAULT 0,
  km_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  primeira_partida TEXT,
  ultima_chegada TEXT,
  tem_tu BOOLEAN NOT NULL DEFAULT false,
  tem_direto BOOLEAN NOT NULL DEFAULT false,
  tem_rendicao BOOLEAN NOT NULL DEFAULT false,
  tem_aproveitamento BOOLEAN NOT NULL DEFAULT false,
  encerra_garagem BOOLEAN NOT NULL DEFAULT false,
  termina_comercial BOOLEAN NOT NULL DEFAULT false,
  detalhes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_classop_servico ON public.classificacao_operacional(servico);
CREATE INDEX idx_classop_versao ON public.classificacao_operacional(versao_programacao);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.classificacao_operacional TO anon, authenticated;
GRANT ALL ON public.classificacao_operacional TO service_role;
ALTER TABLE public.classificacao_operacional ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_classificacao_operacional" ON public.classificacao_operacional FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_classop_touch BEFORE UPDATE ON public.classificacao_operacional
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
