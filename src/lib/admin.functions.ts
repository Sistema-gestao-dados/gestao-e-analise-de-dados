import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(200);
const passwordSchema = z.string().min(6).max(72);
const nomeSchema = z.string().trim().min(1).max(120);
const modulosSchema = z.array(z.string().min(1).max(80)).max(200);
const valoresAcessoSchema = z.array(z.string().min(1).max(120)).max(200);

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
    const [profRes, rolesRes, permsRes, acessoRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("user_id, nome, ativo, modulos_restritos, acesso_restrito").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin.from("user_module_permissions").select("user_id, modulo").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      (supabaseAdmin as any).from("user_data_access").select("user_id, tipo, valor").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const profs = new Map((profRes.data ?? []).map((p: any) => [p.user_id, p]));
    const roleMap = new Map<string, Set<string>>();
    for (const r of (rolesRes.data ?? []) as any[]) {
      const s = roleMap.get(r.user_id) ?? new Set();
      s.add(r.role);
      roleMap.set(r.user_id, s);
    }
    const permsMap = new Map<string, string[]>();
    for (const p of (permsRes.data ?? []) as any[]) {
      const arr = permsMap.get(p.user_id) ?? [];
      arr.push(p.modulo);
      permsMap.set(p.user_id, arr);
    }
    const gruposMap = new Map<string, string[]>();
    const empresasMap = new Map<string, string[]>();
    for (const a of (acessoRes.data ?? []) as any[]) {
      const mapa = a.tipo === "grupo" ? gruposMap : empresasMap;
      const arr = mapa.get(a.user_id) ?? [];
      arr.push(a.valor);
      mapa.set(a.user_id, arr);
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
        modulosRestritos: p?.modulos_restritos ?? false,
        modulos: permsMap.get(u.id) ?? [],
        acessoRestrito: p?.acesso_restrito ?? false,
        gruposPermitidos: gruposMap.get(u.id) ?? [],
        empresasPermitidos: empresasMap.get(u.id) ?? [],
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
      modulosRestritos: z.boolean().default(false),
      modulos: modulosSchema.default([]),
      acessoRestrito: z.boolean().default(false),
      gruposPermitidos: valoresAcessoSchema.default([]),
      empresasPermitidos: valoresAcessoSchema.default([]),
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
    await supabaseAdmin.from("profiles").upsert({ user_id: uid, nome: data.nome, ativo: true, modulos_restritos: data.modulosRestritos, acesso_restrito: data.acessoRestrito } as any);
    if (data.isAdmin) {
      await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "admin" });
    }
    if (data.modulos.length) {
      await supabaseAdmin.from("user_module_permissions").insert(data.modulos.map((modulo) => ({ user_id: uid, modulo })));
    }
    const acessoPayload = [
      ...data.gruposPermitidos.map((valor) => ({ user_id: uid, tipo: "grupo", valor })),
      ...data.empresasPermitidos.map((valor) => ({ user_id: uid, tipo: "empresa", valor })),
    ];
    if (acessoPayload.length) {
      await (supabaseAdmin as any).from("user_data_access").insert(acessoPayload);
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
      modulosRestritos: z.boolean().optional(),
      modulos: modulosSchema.optional(),
      acessoRestrito: z.boolean().optional(),
      gruposPermitidos: valoresAcessoSchema.optional(),
      empresasPermitidos: valoresAcessoSchema.optional(),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertCallerAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.nome !== undefined || data.ativo !== undefined || data.modulosRestritos !== undefined || data.acessoRestrito !== undefined) {
      const upd: { nome?: string; ativo?: boolean; modulos_restritos?: boolean; acesso_restrito?: boolean } = {};
      if (data.nome !== undefined) upd.nome = data.nome;
      if (data.ativo !== undefined) upd.ativo = data.ativo;
      if (data.modulosRestritos !== undefined) upd.modulos_restritos = data.modulosRestritos;
      if (data.acessoRestrito !== undefined) upd.acesso_restrito = data.acessoRestrito;
      await supabaseAdmin.from("profiles").update(upd as any).eq("user_id", data.userId);
    }
    if (data.modulos !== undefined) {
      // Substitui a lista inteira (apaga tudo e insere de novo) — mais simples
      // e seguro que tentar calcular o diff, e a lista nunca é grande.
      await supabaseAdmin.from("user_module_permissions").delete().eq("user_id", data.userId);
      if (data.modulos.length) {
        await supabaseAdmin.from("user_module_permissions").insert(data.modulos.map((modulo) => ({ user_id: data.userId, modulo })));
      }
    }
    if (data.gruposPermitidos !== undefined || data.empresasPermitidos !== undefined) {
      // Mesma estratégia: substitui o que foi passado (grupo e/ou empresa),
      // sem mexer no outro tipo se ele não veio nessa chamada.
      const tipos: string[] = [];
      if (data.gruposPermitidos !== undefined) tipos.push("grupo");
      if (data.empresasPermitidos !== undefined) tipos.push("empresa");
      await (supabaseAdmin as any).from("user_data_access").delete().eq("user_id", data.userId).in("tipo", tipos);
      const payload = [
        ...(data.gruposPermitidos ?? []).map((valor) => ({ user_id: data.userId, tipo: "grupo", valor })),
        ...(data.empresasPermitidos ?? []).map((valor) => ({ user_id: data.userId, tipo: "empresa", valor })),
      ];
      if (payload.length) await (supabaseAdmin as any).from("user_data_access").insert(payload);
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
