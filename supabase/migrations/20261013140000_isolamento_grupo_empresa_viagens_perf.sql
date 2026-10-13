-- Corrige o apagão causado pela Fase 2 (20261013130000): a política
-- RESTRICTIVE chamava resolver_grupo_viagem()/resolver_empresa_viagem()
-- (com unaccent/upper/trim + subconsultas) PRA CADA UMA das 54.855 linhas
-- de `viagens`, toda vez que Resumo/Comparativo/Dashboard baixavam a
-- tabela inteira. Testado ao vivo: ~6s só pras 10 primeiras páginas de
-- 1000 linhas, em paralelo — inviável.
--
-- Correção: para de CALCULAR Grupo/Empresa a cada leitura e passa a
-- GUARDAR o resultado já pronto em cada viagem (`grupo_resolvido`/
-- `empresa_resolvida`), mantido em dia por gatilho. A política RLS vira
-- uma comparação direta de coluna — sem chamar função nenhuma por linha.
--
-- Tudo dentro de uma transação: se algo falhar no meio, desfaz tudo
-- sozinho, não fica pela metade.

BEGIN;

SET LOCAL statement_timeout = '300s';

-- 1) Colunas novas (ALTER TABLE ADD COLUMN sem DEFAULT é só metadado,
--    instantâneo mesmo em tabela grande — não reescreve a tabela).
ALTER TABLE public.viagens ADD COLUMN IF NOT EXISTS grupo_resolvido text;
ALTER TABLE public.viagens ADD COLUMN IF NOT EXISTS empresa_resolvida text;

-- 2) Preenche as 54.855 linhas existentes de uma vez só (custo pago aqui,
--    nesta migração — nunca mais a cada tela aberta).
UPDATE public.viagens
SET grupo_resolvido = public.resolver_grupo_viagem(linha, origem, destino),
    empresa_resolvida = public.resolver_empresa_viagem(linha, origem, destino);

-- 3) Índices pra quando um usuário restrito filtrar por Grupo/Empresa.
CREATE INDEX IF NOT EXISTS idx_viagens_grupo_resolvido ON public.viagens (grupo_resolvido);
CREATE INDEX IF NOT EXISTS idx_viagens_empresa_resolvida ON public.viagens (empresa_resolvida);

-- 4) Gatilho: toda viagem nova (importação) ou editada (linha/origem/
--    destino) recalcula sozinha as 2 colunas, sem precisar de ação manual.
CREATE OR REPLACE FUNCTION public.set_grupo_empresa_viagem()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.grupo_resolvido := public.resolver_grupo_viagem(NEW.linha, NEW.origem, NEW.destino);
  NEW.empresa_resolvida := public.resolver_empresa_viagem(NEW.linha, NEW.origem, NEW.destino);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_grupo_empresa_viagem ON public.viagens;
CREATE TRIGGER trg_set_grupo_empresa_viagem
  BEFORE INSERT OR UPDATE OF linha, origem, destino ON public.viagens
  FOR EACH ROW EXECUTE FUNCTION public.set_grupo_empresa_viagem();

-- 5) Se o cadastro de uma linha mudar (ordem/empresa em `linhas`, ou uma
--    exceção em `linha_empresa_estacao`), recalcula só as viagens
--    daquela linha — não a tabela inteira, e só acontece em ação rara de
--    admin (cadastro de linha), não em toda leitura.
CREATE OR REPLACE FUNCTION public.recompute_grupo_empresa_viagens_por_linha(p_linha text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.viagens
  SET grupo_resolvido = public.resolver_grupo_viagem(linha, origem, destino),
      empresa_resolvida = public.resolver_empresa_viagem(linha, origem, destino)
  WHERE linha = p_linha;
$$;

CREATE OR REPLACE FUNCTION public.trg_recompute_grupo_empresa_linhas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_grupo_empresa_viagens_por_linha(COALESCE(NEW.linha, OLD.linha));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_linhas_recompute_grupo_empresa ON public.linhas;
CREATE TRIGGER trg_linhas_recompute_grupo_empresa
  AFTER UPDATE OF ordem, empresa ON public.linhas
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_grupo_empresa_linhas();

CREATE OR REPLACE FUNCTION public.trg_recompute_grupo_empresa_lee()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Em UPDATE que muda a própria coluna `linha` (edita a exceção pra
  -- apontar outra linha, em vez de excluir e recriar), a linha ANTIGA
  -- também fica afetada (perdeu a exceção) — recalcula as duas.
  PERFORM public.recompute_grupo_empresa_viagens_por_linha(COALESCE(NEW.linha, OLD.linha));
  IF TG_OP = 'UPDATE' AND OLD.linha IS DISTINCT FROM NEW.linha THEN
    PERFORM public.recompute_grupo_empresa_viagens_por_linha(OLD.linha);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_lee_recompute_grupo_empresa ON public.linha_empresa_estacao;
CREATE TRIGGER trg_lee_recompute_grupo_empresa
  AFTER INSERT OR UPDATE OR DELETE ON public.linha_empresa_estacao
  FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_grupo_empresa_lee();

-- 6) Política RLS: agora compara as colunas já prontas da PRÓPRIA linha
--    (`viagens.grupo_resolvido`/`empresa_resolvida`) em vez de chamar
--    função nenhuma. As subconsultas em profiles/user_data_access não
--    dependem de nenhuma coluna de `viagens`, então o Postgres resolve
--    elas 1 vez só (não por linha) — é a combinação dos dois que torna
--    isso rápido.
DROP POLICY IF EXISTS "restringe_grupo_empresa_viagens" ON public.viagens;
CREATE POLICY "restringe_grupo_empresa_viagens" ON public.viagens
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR NOT coalesce((SELECT acesso_restrito FROM public.profiles WHERE user_id = auth.uid()), false)
    OR EXISTS (
      SELECT 1 FROM public.user_data_access uda
      WHERE uda.user_id = auth.uid()
        AND (
          (uda.tipo = 'grupo' AND uda.valor = viagens.grupo_resolvido)
          OR (uda.tipo = 'empresa' AND uda.valor = viagens.empresa_resolvida)
        )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR NOT coalesce((SELECT acesso_restrito FROM public.profiles WHERE user_id = auth.uid()), false)
    OR EXISTS (
      SELECT 1 FROM public.user_data_access uda
      WHERE uda.user_id = auth.uid()
        AND (
          (uda.tipo = 'grupo' AND uda.valor = viagens.grupo_resolvido)
          OR (uda.tipo = 'empresa' AND uda.valor = viagens.empresa_resolvida)
        )
    )
  );

COMMIT;
