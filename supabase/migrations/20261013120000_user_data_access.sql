-- Fase 1 do isolamento por Grupo/Empresa: só a base (tabela + coluna +
-- RLS), aditivo e sem risco nenhum — ninguém perde acesso sozinho.
-- `acesso_restrito` nasce FALSE pra todo mundo (igual já é feito com
-- `modulos_restritos`): só passa a valer quando o admin liga pra um
-- usuário específico. Até lá, todo mundo continua vendo tudo, exatamente
-- como hoje. A APLICAÇÃO de fato (filtrar relatórios/RLS em viagens etc.)
-- fica pra uma fase seguinte, depois de testar bem.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS acesso_restrito BOOLEAN NOT NULL DEFAULT false;

-- `valor` guarda o nome do Grupo (ex.: "Grupo Rio Ita") ou da Empresa (ex.:
-- "Viação Maué"), o mesmo texto já usado nos filtros "GRUPO"/"EMPRESA" dos
-- relatórios (resolveGrupoViagem/resolveEmpresaViagem — linhas.ordem/
-- linhas.empresa + exceção por estação). Um usuário pode ter vários
-- grupos e/ou empresas liberados.
CREATE TABLE public.user_data_access (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('grupo', 'empresa')),
  valor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tipo, valor)
);

GRANT SELECT ON public.user_data_access TO authenticated;
GRANT ALL ON public.user_data_access TO service_role;
ALTER TABLE public.user_data_access ENABLE ROW LEVEL SECURITY;

-- Mesma regra de user_module_permissions: cada usuário só lê os próprios
-- acessos (usado pelo app pra aplicar a restrição); admin lê de todo
-- mundo (usado na tela de Usuários). Escrita só por admin.
CREATE POLICY "uda_self_or_admin_select" ON public.user_data_access
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "uda_admin_write" ON public.user_data_access
  FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
