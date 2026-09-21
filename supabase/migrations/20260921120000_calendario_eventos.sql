-- Calendário de informações operacionais: eventos por dia/período (chuva,
-- obras na via, redução operacional etc.) pra sinalizar visualmente que um
-- dia ou período não deve ser usado como referência pra reprogramação de
-- linha. `linha` NULL = evento vale pra todas as linhas (ex.: chuva na
-- cidade toda); preenchido = só afeta aquela linha (ex.: obra pontual).
CREATE TABLE IF NOT EXISTS public.calendario_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  categoria TEXT NOT NULL,
  linha TEXT,
  descricao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calendario_eventos_periodo_valido CHECK (data_fim >= data_inicio)
);
CREATE INDEX idx_calendario_eventos_periodo ON public.calendario_eventos(data_inicio, data_fim);

CREATE TRIGGER trg_calendario_eventos_touch BEFORE UPDATE ON public.calendario_eventos
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendario_eventos TO authenticated;
GRANT ALL ON public.calendario_eventos TO service_role;
ALTER TABLE public.calendario_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_calendario_eventos" ON public.calendario_eventos
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
