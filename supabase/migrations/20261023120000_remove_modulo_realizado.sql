-- Remove o módulo "Previsto e Realizado" (telas /realizado e
-- /importacao-realizado) e TODOS os dados dele — pedido do usuário em
-- 23/out/2026 pra liberar espaço. Irreversível: os dados de
-- `viagens_realizado` somem de vez (reimportar exigiria recriar a tabela
-- de 20260905130000_viagens_realizado.sql).

DROP FUNCTION IF EXISTS public.viagens_realizado_datas();
DROP TABLE IF EXISTS public.viagens_realizado;

-- Log das importações desse módulo (tela Importação / Verificação de
-- Integridade) e permissões de tela que apontavam pra ele.
DELETE FROM public.importacoes WHERE tipo = 'Realizado (Cittati)';
DELETE FROM public.user_module_permissions WHERE modulo IN ('realizado', 'importacao_realizado');
