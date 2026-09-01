
DROP POLICY IF EXISTS "audit_no_update" ON public.audit_log;
DROP POLICY IF EXISTS "audit_no_delete" ON public.audit_log;
CREATE POLICY "audit_no_update" ON public.audit_log FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "audit_no_delete" ON public.audit_log FOR DELETE TO authenticated, anon USING (false);
