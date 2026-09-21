-- Cor customizável por categoria do calendário (chave = categoria em
-- minúsculas, sem espaços nas pontas). Sem linha aqui pra uma categoria =
-- usa a cor padrão sugerida no código (src/lib/calendario.ts).
CREATE TABLE IF NOT EXISTS public.calendario_categoria_cor (
  categoria TEXT PRIMARY KEY,
  cor TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_calendario_categoria_cor_touch BEFORE UPDATE ON public.calendario_categoria_cor
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendario_categoria_cor TO authenticated;
GRANT ALL ON public.calendario_categoria_cor TO service_role;
ALTER TABLE public.calendario_categoria_cor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_calendario_categoria_cor" ON public.calendario_categoria_cor
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
