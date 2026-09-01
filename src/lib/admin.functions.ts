import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const passwordSchema = z.string().min(6).max(72);
const nomeSchema = z.string().trim().min(1).max(120);

// PUBLIC: report whether the very first admin still needs to be created.
export const bootstrapNeeded = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) throw new Error(error.message);
  return { needed: (count ?? 0) === 0 };
});

// PUBLIC (guarded): allowed only while no admin exists. Creates first admin.
export const bootstrapAdmin = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ email: emailSchema, password: passwordSchema, nome: nomeSchema }).parse(raw),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) > 0) throw new Error("Sistema já possui administrador cadastrado.");

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (created.error) throw new Error(created.error.message);
    const uid = created.data.user?.id;
    if (!uid) throw new Error("Falha ao criar usuário.");

    await supabaseAdmin.from("profiles").upsert({ user_id: uid, nome: data.nome, ativo: true });
    const roleIns = await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "admin" });
    if (roleIns.error) throw new Error(roleIns.error.message);
    return { ok: true, userId: uid };
  });

async function assertCallerAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Somente administradores podem executar esta operação.");
}

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCallerAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const list = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (list.error) throw new Error(list.error.message);
    const users = list.data.users ?? [];
    const ids = users.map((u) => u.id);
    const [profRes, rolesRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("user_id, nome, ativo").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const profs = new Map((profRes.data ?? []).map((p: any) => [p.user_id, p]));
    const roleMap = new Map<string, Set<string>>();
    for (const r of (rolesRes.data ?? []) as any[]) {
      const s = roleMap.get(r.user_id) ?? new Set();
      s.add(r.role);
      roleMap.set(r.user_id, s);
    }
    return users.map((u) => {
      const p = profs.get(u.id) as any;
      const roles = roleMap.get(u.id) ?? new Set();
      return {
        id: u.id,
        email: u.email ?? "",
        nome: p?.nome ?? "",
        ativo: p?.ativo ?? true,
        isAdmin: roles.has("admin"),
        created_at: u.created_at,
      };
    });
  });

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({
      email: emailSchema,
      password: passwordSchema,
      nome: nomeSchema,
      isAdmin: z.boolean().default(false),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertCallerAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (created.error) throw new Error(created.error.message);
    const uid = created.data.user!.id;
    await supabaseAdmin.from("profiles").upsert({ user_id: uid, nome: data.nome, ativo: true });
    if (data.isAdmin) {
      await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "admin" });
    }
    return { ok: true, userId: uid };
  });

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({
      userId: z.string().uuid(),
      nome: nomeSchema.optional(),
      ativo: z.boolean().optional(),
      isAdmin: z.boolean().optional(),
      password: passwordSchema.optional(),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertCallerAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.nome !== undefined || data.ativo !== undefined) {
      const upd: { nome?: string; ativo?: boolean } = {};
      if (data.nome !== undefined) upd.nome = data.nome;
      if (data.ativo !== undefined) upd.ativo = data.ativo;
      await supabaseAdmin.from("profiles").update(upd).eq("user_id", data.userId);
    }
    if (data.password) {
      const res = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
      if (res.error) throw new Error(res.error.message);
    }
    if (data.ativo === false) {
      // Optional: block sign-in until re-activated
      await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "876000h" });
    } else if (data.ativo === true) {
      await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "none" });
    }
    if (data.isAdmin !== undefined) {
      if (data.userId === context.userId && data.isAdmin === false) {
        throw new Error("Você não pode remover seu próprio acesso de administrador.");
      }
      if (data.isAdmin) {
        await supabaseAdmin.from("user_roles").upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
      } else {
        await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", "admin");
      }
    }
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ userId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertCallerAdmin(context.supabase, context.userId);
    if (data.userId === context.userId) throw new Error("Você não pode excluir a si mesmo.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });
