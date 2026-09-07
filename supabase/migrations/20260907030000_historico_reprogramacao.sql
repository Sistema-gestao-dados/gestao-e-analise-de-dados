-- Módulo "Histórico de Reprogramação": registra quando/por quê a escala de
-- uma linha mudou. Não duplica cadastro de Linha/Empresa/Grupo — usa o
-- Cadastro de Linhas e Grupos de Linhas que já existem no sistema.

CREATE TABLE public.historico_dia_tipos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.historico_dia_tipos TO anon, authenticated;
GRANT ALL ON public.historico_dia_tipos TO service_role;
ALTER TABLE public.historico_dia_tipos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_historico_dia_tipos" ON public.historico_dia_tipos FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.historico_reprogramacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linha TEXT NOT NULL,
  versao INTEGER,
  dia_tipo TEXT,
  data_solicitacao DATE,
  vigencia DATE,
  encerramento DATE,
  alteracao TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_historico_reprogramacao_linha ON public.historico_reprogramacao(linha);
CREATE INDEX idx_historico_reprogramacao_vigencia ON public.historico_reprogramacao(vigencia);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.historico_reprogramacao TO anon, authenticated;
GRANT ALL ON public.historico_reprogramacao TO service_role;
ALTER TABLE public.historico_reprogramacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_historico_reprogramacao" ON public.historico_reprogramacao FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_historico_reprogramacao_touch
  BEFORE UPDATE ON public.historico_reprogramacao
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
