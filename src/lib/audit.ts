import { supabase } from "@/integrations/supabase/client";

export type AuditAction =
  | "login_success"
  | "login_fail"
  | "logout"
  | "create"
  | "update"
  | "delete"
  | "import"
  | "export"
  | "view";

type AuditUserLike = { id?: string; username?: string; email?: string } | null | undefined;

type Args = {
  user?: AuditUserLike;
  username?: string;
  action: AuditAction;
  entity?: string;
  entity_id?: string | number | null;
  details?: Record<string, unknown> | null;
};

export async function logAudit(args: Args): Promise<void> {
  try {
    let uid: string | null = args.user?.id ?? null;
    let uname: string | null = args.username ?? args.user?.username ?? args.user?.email ?? null;
    if (!uid || !uname) {
      const { data } = await supabase.auth.getUser();
      uid = uid ?? data.user?.id ?? null;
      uname = uname ?? data.user?.email ?? null;
    }
    const payload = {
      user_id: uid,
      username: uname,
      action: args.action,
      entity: args.entity ?? null,
      entity_id: args.entity_id != null ? String(args.entity_id) : null,
      details: args.details ?? null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    };
    await (supabase as any).from("audit_log").insert(payload);
  } catch (e) {
    // never block UI for audit failures (also fires when unauthenticated: expected)
    console.warn("[audit] failed", e);
  }
}
