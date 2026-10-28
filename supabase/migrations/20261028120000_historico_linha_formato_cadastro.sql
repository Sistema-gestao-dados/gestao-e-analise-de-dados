-- Histórico de Reprogramação com código de linha sem o zero à esquerda
-- ("1" em vez de "01", "8" em vez de "08") — vinha de CSV salvo no Excel,
-- que tira o zero. Assim a linha não casava com o Cadastro de Linhas
-- (Empresa, Grupo de Linha, Conferência Histórico × Versões).
--
-- Corrige pro código do cadastro, comparando sem zero à esquerda no número
-- do início ("1" = "01", "8A" = "08A") — mesma regra de chaveLinha() em
-- src/lib/historico.ts. Só mexe em linha que NÃO existe no cadastro como
-- está e que tem UMA correspondência só (se o cadastro tiver "1" e "01",
-- não adivinha). Daqui pra frente a importação CSV já grava no formato do
-- cadastro.
--
-- Pra conferir ANTES de corrigir, rode só o SELECT abaixo:
--
--   WITH cad AS (
--     SELECT linha, upper(regexp_replace(trim(linha), '^0+(?=[0-9])', '')) AS chave FROM public.linhas
--   ), unicos AS (
--     SELECT chave, min(linha) AS linha FROM cad GROUP BY chave HAVING count(*) = 1
--   )
--   SELECT h.linha AS atual, u.linha AS corrigida, count(*) AS registros
--   FROM public.historico_reprogramacao h
--   JOIN unicos u ON upper(regexp_replace(trim(h.linha), '^0+(?=[0-9])', '')) = u.chave
--   WHERE h.linha <> u.linha
--     AND NOT EXISTS (SELECT 1 FROM public.linhas l WHERE l.linha = h.linha)
--   GROUP BY 1, 2 ORDER BY 2;

BEGIN;

WITH cad AS (
  SELECT linha, upper(regexp_replace(trim(linha), '^0+(?=[0-9])', '')) AS chave FROM public.linhas
), unicos AS (
  SELECT chave, min(linha) AS linha FROM cad GROUP BY chave HAVING count(*) = 1
)
UPDATE public.historico_reprogramacao h
SET linha = u.linha
FROM unicos u
WHERE upper(regexp_replace(trim(h.linha), '^0+(?=[0-9])', '')) = u.chave
  AND h.linha <> u.linha
  AND NOT EXISTS (SELECT 1 FROM public.linhas l WHERE l.linha = h.linha);

COMMIT;
