import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Somente administradores podem executar esta operação.");
}

export const clearAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error, count } = await supabaseAdmin
      .from("audit_log")
      .delete({ count: "exact" })
      .not("id", "is", null);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });

export const clearImportacoes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error, count } = await supabaseAdmin
      .from("importacoes")
      .delete({ count: "exact" })
      .not("id", "is", null);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });
