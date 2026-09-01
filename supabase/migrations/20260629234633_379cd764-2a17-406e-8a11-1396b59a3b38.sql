CREATE TABLE public.app_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username text NOT NULL UNIQUE,
  nome text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO anon, authenticated;
GRANT ALL ON public.app_users TO service_role;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_all_app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_app_users_touch BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();