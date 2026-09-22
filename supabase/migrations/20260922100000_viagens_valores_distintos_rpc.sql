-- Função de servidor pra listar os valores distintos usados nos filtros da
-- tela de Viagens (Dia Tipo, Versão, Arquivo). Antes disso, a tela baixava
-- a tabela `viagens` inteira uma SEGUNDA vez (além do fetch já feito pro
-- grid) só pra montar essas 3 listas no navegador — puro desperdício de
-- rede/memória que cresce junto com o volume de dados importados. Com essa
-- função, quem calcula o "distinct" é o Postgres, e só trafega os poucos
-- valores únicos, não a tabela toda.
CREATE OR REPLACE FUNCTION public.viagens_valores_distintos()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tipos_operacao', (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM (SELECT DISTINCT tipo_operacao AS v FROM public.viagens WHERE tipo_operacao IS NOT NULL) s),
    'versoes', (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM (SELECT DISTINCT versao_programacao AS v FROM public.viagens WHERE versao_programacao IS NOT NULL) s),
    'arquivos', (SELECT coalesce(jsonb_agg(v ORDER BY v), '[]'::jsonb) FROM (SELECT DISTINCT arquivo AS v FROM public.viagens WHERE arquivo IS NOT NULL) s)
  );
$$;

-- SECURITY INVOKER (padrão) de propósito: roda com o RLS de quem chama, não
-- eleva privilégio nenhum — só junta 3 SELECT DISTINCT que qualquer usuário
-- autenticado já podia rodar um por um.
GRANT EXECUTE ON FUNCTION public.viagens_valores_distintos() TO authenticated;
