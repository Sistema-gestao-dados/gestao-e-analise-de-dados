CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NULL,
  username text NULL,
  action text NOT NULL,
  entity text NULL,
  entity_id text NULL,
  details jsonb NULL,
  user_agent text NULL
);

CREATE INDEX idx_audit_log_created_at ON public.audit_log (created_at DESC);
CREATE INDEX idx_audit_log_username ON public.audit_log (username);
CREATE INDEX idx_audit_log_action ON public.audit_log (action);
CREATE INDEX idx_audit_log_entity ON public.audit_log (entity);

GRANT SELECT, INSERT ON public.audit_log TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY public_all_audit_log ON public.audit_log
  FOR ALL TO public USING (true) WITH CHECK (true);
