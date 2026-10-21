-- Datas distintas já importadas em `viagens_realizado` (tela Realizado —
-- aviso "X dia(s) importado(s), de A a B"). Antes o app buscava a coluna
-- `data` linha a linha com limite de 5000 registros: com ~3 mil viagens por
-- dia, isso cobria só os 1-2 dias mais recentes. Aqui o Postgres devolve só
-- as datas distintas (usa o índice idx_viagens_realizado_data).
--
-- SECURITY INVOKER (padrão): roda com o RLS de quem chama.
CREATE OR REPLACE FUNCTION public.viagens_realizado_datas()
RETURNS SETOF date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT data FROM public.viagens_realizado WHERE data IS NOT NULL ORDER BY data DESC;
$$;

REVOKE ALL ON FUNCTION public.viagens_realizado_datas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viagens_realizado_datas() TO authenticated;
