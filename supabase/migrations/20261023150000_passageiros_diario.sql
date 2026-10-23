-- Passageiros e receita por linha e por dia — planilha "DADOS PAX" (uma
-- coluna-bloco por linha: Viagens Realizadas, KM, Transportados, Pagantes,
-- Receita, Gratuidades; uma linha por dia). Ver src/lib/passageiros.ts.
--
-- Uma linha da tabela = (linha, data). Reimportar o mesmo período SOBRESCREVE
-- (upsert na chave única), não duplica. Dia em que a linha não rodou ("-" na
-- planilha) não tem registro.
--
-- Empresa/Grupo/Unidade NÃO são gravados aqui: saem do cadastro de `linhas`
-- na hora de exibir (a planilha não tem estação, então não há exceção por
-- estação — vale o cadastro da linha).
CREATE TABLE IF NOT EXISTS public.passageiros_diario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linha TEXT NOT NULL,
  data DATE NOT NULL,
  viagens INTEGER,
  km NUMERIC(12, 2),
  transportados INTEGER,
  pagantes INTEGER,
  receita NUMERIC(14, 2),
  gratuidades INTEGER,
  arquivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT passageiros_diario_linha_data_key UNIQUE (linha, data)
);

CREATE INDEX IF NOT EXISTS idx_passageiros_diario_data ON public.passageiros_diario (data);

CREATE TRIGGER trg_passageiros_diario_touch BEFORE UPDATE ON public.passageiros_diario
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.passageiros_diario TO authenticated;
GRANT ALL ON public.passageiros_diario TO service_role;
ALTER TABLE public.passageiros_diario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_passageiros_diario" ON public.passageiros_diario
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Acesso restrito por Grupo/Empresa: mesmo padrão de parametro_km
-- (20261021120000_isolamento_grupo_empresa_cadastros.sql) — lista de linhas
-- do usuário calculada 1x por consulta, cada linha só faz `= ANY(array)`.
CREATE POLICY "restringe_grupo_empresa_passageiros_diario" ON public.passageiros_diario
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT (SELECT public.acesso_usuario_restrito())
    OR linha = ANY ((SELECT public.acesso_linhas_usuario())::text[])
  )
  WITH CHECK (
    NOT (SELECT public.acesso_usuario_restrito())
    OR linha = ANY ((SELECT public.acesso_linhas_usuario())::text[])
  );

-- Meses já importados (tela de importação — "Períodos importados"), sem
-- baixar a tabela inteira. SECURITY INVOKER (padrão): respeita o RLS acima.
CREATE OR REPLACE FUNCTION public.passageiros_diario_meses()
RETURNS TABLE (mes DATE, dias BIGINT, linhas BIGINT, registros BIGINT, inicio DATE, fim DATE)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT date_trunc('month', data)::date AS mes,
         count(DISTINCT data) AS dias,
         count(DISTINCT linha) AS linhas,
         count(*) AS registros,
         min(data) AS inicio,
         max(data) AS fim
  FROM public.passageiros_diario
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.passageiros_diario_meses() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.passageiros_diario_meses() TO authenticated;
