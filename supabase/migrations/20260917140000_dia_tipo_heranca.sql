-- Guarda, pra cada dia tipo NOVO (ex.: "Feriado SG 22-09-26"), qual foi o
-- dia tipo "pai" escolhido no wizard de importação (Dias úteis / Sábado /
-- Domingo). Hoje essa escolha só é usada na hora (pra copiar Grupo de
-- Linha) e depois se perde — precisamos dela guardada pra decidir, no
-- Comparativo, se uma linha "sem dado" no dia novo deve repetir o pai ou
-- não (olhando se o GRUPO DE LINHA inteiro dela teve alguma viagem no dia
-- novo, não só a linha isolada).
CREATE TABLE IF NOT EXISTS public.dia_tipo_heranca (
  tipo_dia TEXT PRIMARY KEY,
  tipo_dia_pai TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.dia_tipo_heranca TO authenticated;
GRANT ALL ON public.dia_tipo_heranca TO service_role;
ALTER TABLE public.dia_tipo_heranca ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_dia_tipo_heranca" ON public.dia_tipo_heranca
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
