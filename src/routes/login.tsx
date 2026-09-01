import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bus, Loader2, Lock, Mail, ShieldPlus, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { bootstrapAdmin, bootstrapNeeded } from "@/lib/admin.functions";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : "",
  }),
  component: LoginPage,
});

function LoginPage() {
  const { login, user, refresh } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  const [bNome, setBNome] = useState("");
  const check = useServerFn(bootstrapNeeded);
  const doBootstrap = useServerFn(bootstrapAdmin);

  useEffect(() => {
    if (user) navigate({ to: safeNext, replace: true });
  }, [user, navigate]);

  useEffect(() => {
    void check().then((r) => setNeedsBootstrap(!!r.needed)).catch(() => {});
  }, [check]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const res = await login(email, password);
    setSubmitting(false);
    if (res.ok) {
      toast.success("Bem-vindo!");
      navigate({ to: safeNext, replace: true });
    } else {
      toast.error(res.error ?? "Falha no login");
    }
  };

  const onBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !bNome) return toast.error("Preencha todos os campos.");
    setSubmitting(true);
    try {
      await doBootstrap({ data: { email: email.trim(), password, nome: bNome.trim() } });
      toast.success("Administrador criado. Faça login.");
      setBootstrapOpen(false);
      setNeedsBootstrap(false);
      const r = await login(email, password);
      if (r.ok) {
        await refresh();
        navigate({ to: safeNext, replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar admin");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center shadow-lg">
            <Bus className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-foreground">Gestão e Análise de Dados</h1>
          <p className="text-sm text-muted-foreground">Análise Operacional de Transporte</p>
        </div>

        {!bootstrapOpen ? (
          <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="email" type="email" autoComplete="username" autoFocus className="pl-9"
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="password" type="password" autoComplete="current-password" className="pl-9"
                  value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
            </Button>
            {needsBootstrap && (
              <div className="pt-3 border-t border-border text-center">
                <p className="text-xs text-muted-foreground mb-2">Nenhum administrador cadastrado ainda.</p>
                <Button type="button" variant="outline" className="w-full" onClick={() => setBootstrapOpen(true)}>
                  <ShieldPlus className="h-4 w-4 mr-2" /> Criar primeiro administrador
                </Button>
              </div>
            )}
          </form>
        ) : (
          <form onSubmit={onBootstrap} className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
            <div className="text-sm font-semibold flex items-center gap-2"><ShieldPlus className="h-4 w-4" /> Criar administrador inicial</div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" value={bNome} onChange={(e) => setBNome(e.target.value)} placeholder="Seu nome" autoFocus />
              </div>
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@empresa.com" />
            </div>
            <div className="space-y-2">
              <Label>Senha (mín. 6 caracteres)</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setBootstrapOpen(false)}>Voltar</Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar admin"}
              </Button>
            </div>
          </form>
        )}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Acesso restrito. Solicite credenciais ao administrador.
        </p>
      </div>
    </div>
  );
}
