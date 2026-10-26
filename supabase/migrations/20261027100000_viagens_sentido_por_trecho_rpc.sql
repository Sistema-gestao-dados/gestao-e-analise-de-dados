-- Sentido (Ida/Volta) por trecho (linha + origem + destino) a partir das
-- viagens importadas — usado no "Baixar modelo (com dados atuais)" do
-- Cadastro Unificado (/importacao) pra preencher a coluna "sentido" da aba
-- KM. Agrupa no banco (poucas centenas de linhas) em vez de baixar as
-- dezenas de milhares de viagens no navegador.
--
-- SECURITY INVOKER (padrão): roda com o RLS de `viagens` de quem chama —
-- usuário restrito só enxerga os trechos do próprio Grupo/Empresa.
CREATE OR REPLACE FUNCTION public.viagens_sentido_por_trecho()
RETURNS TABLE (linha TEXT, origem TEXT, destino TEXT, sentido TEXT, viagens BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT linha, origem, destino, sentido, count(*) AS viagens
  FROM public.viagens
  WHERE sentido IS NOT NULL AND trim(sentido) <> ''
    AND origem IS NOT NULL AND destino IS NOT NULL
  GROUP BY linha, origem, destino, sentido;
$$;

REVOKE ALL ON FUNCTION public.viagens_sentido_por_trecho() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viagens_sentido_por_trecho() TO authenticated;
