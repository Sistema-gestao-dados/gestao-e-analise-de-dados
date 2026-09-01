import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppUser = {
  id: string;
  email: string;
  nome: string;
  isAdmin: boolean;
};

type AuthCtx = {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  can: (modulo: string) => boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

// Modules that require admin role
const ADMIN_ONLY = new Set(["usuarios", "auditoria"]);

async function fetchUserContext(userId: string, email: string): Promise<AppUser> {
  const [profileRes, rolesRes] = await Promise.all([
    supabase.from("profiles").select("nome").eq("user_id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const profile = profileRes.data as { nome?: string } | null;
  const roles = (rolesRes.data ?? []) as { role: string }[];
  return {
    id: userId,
    email,
    nome: profile?.nome?.trim() || email.split("@")[0],
    isAdmin: roles.some((r) => r.role === "admin"),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const s = data.session;
    if (!s?.user) {
      setUser(null);
      return;
    }
    try {
      const ctx = await fetchUserContext(s.user.id, s.user.email ?? "");
      setUser(ctx);
    } catch {
      setUser({ id: s.user.id, email: s.user.email ?? "", nome: s.user.email?.split("@")[0] ?? "", isAdmin: false });
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT" || !session) {
        setUser(null);
        return;
      }
      // Defer supabase calls to avoid deadlock inside callback
      setTimeout(() => { void hydrate(); }, 0);
    });
    void hydrate().finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [hydrate]);

  const login: AuthCtx["login"] = async (email, password) => {
    const e = email.trim();
    if (!e || !password) return { ok: false, error: "Informe e-mail e senha." };
    const { error } = await supabase.auth.signInWithPassword({ email: e, password });
    if (error) return { ok: false, error: error.message };
    await hydrate();
    return { ok: true };
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const isAdmin = !!user?.isAdmin;
  const can: AuthCtx["can"] = (modulo) => {
    if (!user) return false;
    if (ADMIN_ONLY.has(modulo)) return isAdmin;
    return true;
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, can, isAdmin, refresh: hydrate }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

export const MODULES: { key: string; label: string }[] = [
  { key: "dashboard_operacional", label: "Dashboard Operacional" },
  { key: "resumo_operacional", label: "Resumo Operacional" },
  { key: "resumo_linha", label: "Resumo por Linha" },
  { key: "relatorio_comparativo", label: "Relatório Comparativo" },
  { key: "jornada", label: "Jornada de Trabalho" },
  { key: "pesquisa", label: "Pesquisa" },
  { key: "linhas", label: "Cadastro de Linhas" },
  { key: "cadastro_km", label: "Cadastro de KM" },
  { key: "cadastro_grupos", label: "Grupos de Linhas" },
  { key: "viagens", label: "Viagens" },
  { key: "importacao", label: "Importação CSV" },
  { key: "importacao_txt", label: "Importação TXT GPS" },
  { key: "historico", label: "Histórico" },
  { key: "bi_cittati_conversor", label: "Conversor BI Cittati → TXT" },
  { key: "relatorio_viagens_conversor", label: "Conversor Relat. Viagens → TXT" },
  { key: "passagem_trecho_conversor", label: "Conversor Passagem Trecho → TXT" },
  { key: "auditoria", label: "Auditoria (admin)" },
  { key: "usuarios", label: "Usuários (admin)" },
];

// Kept for signature compatibility with usuarios.tsx (unused by new auth)
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
