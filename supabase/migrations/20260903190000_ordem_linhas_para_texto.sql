-- O campo "ordem" do cadastro de Linhas (rotulado "Grupo" na tela) era
-- numérico, mas passou a aceitar texto livre também (ex.: "A", "GRUPO-1").
ALTER TABLE public.linhas ALTER COLUMN ordem TYPE text USING ordem::text;
