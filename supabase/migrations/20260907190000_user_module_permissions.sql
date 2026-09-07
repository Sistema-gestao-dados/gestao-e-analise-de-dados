-- Permissões granulares por módulo. Por padrão (modulos_restritos = false),
-- o usuário continua vendo tudo, exatamente como hoje — isso preserva o
-- acesso de todo mundo que já existe. Só quando o admin liga
-- "Restringir por módulo" pra um usuário é que a lista abaixo passa a valer
-- de verdade pra ele.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS modulos_restritos BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE public.user_module_permissions (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, modulo)
);

GRANT SELECT ON public.user_module_permissions TO authenticated;
GRANT ALL ON public.user_module_permissions TO service_role;
ALTER TABLE public.user_module_permissions ENABLE ROW LEVEL SECURITY;

-- Cada usuário só lê as próprias permissões (usado pelo app pra montar o
-- menu); admin lê de todo mundo (usado na tela de Usuários).
CREATE POLICY "ump_self_or_admin_select" ON public.user_module_permissions
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Escrita direta só por admin (na prática sempre passa pelo servidor com
-- service_role, mas a política fica coerente com o resto do sistema).
CREATE POLICY "ump_admin_write" ON public.user_module_permissions
  FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
