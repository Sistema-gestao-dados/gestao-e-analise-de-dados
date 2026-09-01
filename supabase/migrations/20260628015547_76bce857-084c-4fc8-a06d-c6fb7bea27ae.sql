
-- ============ LINHAS ============
CREATE TABLE public.linhas (
  linha TEXT PRIMARY KEY,
  empresa TEXT,
  unidade TEXT,
  ordem INTEGER,
  categoria TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linhas TO anon, authenticated;
GRANT ALL ON public.linhas TO service_role;
ALTER TABLE public.linhas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_linhas" ON public.linhas FOR ALL USING (true) WITH CHECK (true);

-- ============ PARAMETRO_KM ============
CREATE TABLE public.parametro_km (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linha TEXT NOT NULL,
  origem TEXT NOT NULL,
  destino TEXT NOT NULL,
  km NUMERIC(10,2) NOT NULL DEFAULT 0,
  descricao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (linha, origem, destino)
);
CREATE INDEX idx_pkm_linha ON public.parametro_km(linha);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parametro_km TO anon, authenticated;
GRANT ALL ON public.parametro_km TO service_role;
ALTER TABLE public.parametro_km ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_pkm" ON public.parametro_km FOR ALL USING (true) WITH CHECK (true);

-- ============ PARAMETRO_MULTILINHA ============
CREATE TABLE public.parametro_multilinha (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linha TEXT NOT NULL,
  grupo_du TEXT NOT NULL,
  tipo_dia TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (linha, grupo_du, tipo_dia)
);
CREATE INDEX idx_pmulti_linha ON public.parametro_multilinha(linha);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parametro_multilinha TO anon, authenticated;
GRANT ALL ON public.parametro_multilinha TO service_role;
ALTER TABLE public.parametro_multilinha ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_pmulti" ON public.parametro_multilinha FOR ALL USING (true) WITH CHECK (true);

-- ============ IMPORTACOES ============
CREATE TABLE public.importacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL,
  arquivo TEXT,
  registros_inseridos INTEGER NOT NULL DEFAULT 0,
  registros_atualizados INTEGER NOT NULL DEFAULT 0,
  registros_erro INTEGER NOT NULL DEFAULT 0,
  detalhes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.importacoes TO anon, authenticated;
GRANT ALL ON public.importacoes TO service_role;
ALTER TABLE public.importacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_importacoes" ON public.importacoes FOR ALL USING (true) WITH CHECK (true);

-- updated_at trigger for linhas
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER trg_linhas_touch BEFORE UPDATE ON public.linhas
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
