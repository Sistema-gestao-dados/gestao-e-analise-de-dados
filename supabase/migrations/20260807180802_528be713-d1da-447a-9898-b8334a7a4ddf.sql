-- 1) remover duplicatas exatas (mantendo o registro mais antigo)
DELETE FROM public.viagens v
USING public.viagens w
WHERE v.ctid > w.ctid
  AND coalesce(v.versao_programacao,'') = coalesce(w.versao_programacao,'')
  AND coalesce(v.tipo_operacao,'') = coalesce(w.tipo_operacao,'')
  AND v.linha = w.linha
  AND coalesce(v.tipo_servico,'') = coalesce(w.tipo_servico,'')
  AND coalesce(v.servico,'') = coalesce(w.servico,'')
  AND coalesce(v.turno,'') = coalesce(w.turno,'')
  AND coalesce(v.partida,'') = coalesce(w.partida,'')
  AND coalesce(v.chegada,'') = coalesce(w.chegada,'')
  AND coalesce(v.origem,'') = coalesce(w.origem,'')
  AND coalesce(v.destino,'') = coalesce(w.destino,'')
  AND coalesce(v.tipo_movimento,'') = coalesce(w.tipo_movimento,'')
  AND coalesce(v.categoria_movimento,'') = coalesce(w.categoria_movimento,'');

-- 2) chave natural para impedir reimportação duplicada
ALTER TABLE public.viagens
  ADD COLUMN IF NOT EXISTS dedupe_key text GENERATED ALWAYS AS (
    coalesce(versao_programacao,'') || '|' || coalesce(tipo_operacao,'') || '|' || linha || '|' ||
    coalesce(tipo_servico,'') || '|' || coalesce(servico,'') || '|' || coalesce(turno,'') || '|' ||
    coalesce(partida,'') || '|' || coalesce(chegada,'') || '|' || coalesce(origem,'') || '|' ||
    coalesce(destino,'') || '|' || coalesce(tipo_movimento,'') || '|' || coalesce(categoria_movimento,'')
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS viagens_dedupe_key_uidx ON public.viagens (dedupe_key);