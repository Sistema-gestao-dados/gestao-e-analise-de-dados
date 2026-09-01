CREATE TABLE public.projeto_ativo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linha text NOT NULL,
  tipo_operacao text NOT NULL,
  versao_programacao text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (linha, tipo_operacao)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projeto_ativo TO authenticated;
GRANT ALL ON public.projeto_ativo TO service_role;

ALTER TABLE public.projeto_ativo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados podem gerenciar projeto_ativo"
  ON public.projeto_ativo
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER projeto_ativo_touch
  BEFORE UPDATE ON public.projeto_ativo
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX projeto_ativo_versao_idx ON public.projeto_ativo (versao_programacao);