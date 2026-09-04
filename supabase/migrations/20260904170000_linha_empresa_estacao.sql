-- Permite que uma mesma linha (ex.: "07", "07A") seja operada por mais de
-- uma empresa, decidindo qual empresa pelo trecho (origem ou destino) da
-- viagem, em vez de uma empresa fixa por linha. Usado quando não há
-- entrada aqui para uma linha, o cadastro normal de Linhas (empresa fixa)
-- continua valendo — isso é só uma exceção por estação.
CREATE TABLE public.linha_empresa_estacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linha TEXT NOT NULL,
  estacao TEXT NOT NULL,
  empresa TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (linha, estacao)
);

CREATE INDEX idx_lee_linha ON public.linha_empresa_estacao(linha);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.linha_empresa_estacao TO anon, authenticated;
GRANT ALL ON public.linha_empresa_estacao TO service_role;
ALTER TABLE public.linha_empresa_estacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_linha_empresa_estacao" ON public.linha_empresa_estacao FOR ALL USING (true) WITH CHECK (true);
