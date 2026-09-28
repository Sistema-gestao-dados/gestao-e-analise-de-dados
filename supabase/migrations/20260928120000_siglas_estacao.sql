-- Dicionário de siglas: traduz os códigos de estação/garagem/ponto que
-- aparecem em viagens.origem/destino (vêm crus do feed GPS Cittati/EasyBus,
-- ex.: "GVA", "ALC" — ver txt-import-easybus.ts) pro nome completo e pro
-- tipo de local (Garagem ou Ponto). Hoje relatórios só mostram a sigla;
-- esse cadastro é o que permite trocar pelo nome legível.
CREATE TABLE IF NOT EXISTS public.siglas_estacao (
  sigla TEXT PRIMARY KEY,
  descricao TEXT NOT NULL,
  local TEXT NOT NULL CHECK (local IN ('Garagem', 'Ponto')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_siglas_estacao_touch BEFORE UPDATE ON public.siglas_estacao
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.siglas_estacao TO authenticated;
GRANT ALL ON public.siglas_estacao TO service_role;
ALTER TABLE public.siglas_estacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_siglas_estacao" ON public.siglas_estacao
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
