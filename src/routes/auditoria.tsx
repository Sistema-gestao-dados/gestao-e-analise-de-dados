import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { describeAuditEvent } from "@/lib/audit-describe";
import { clearAuditLog } from "@/lib/admin-audit.functions";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Activity, Loader2, RefreshCw, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

export const Route = createFileRoute("/auditoria")({
  head: () => ({ meta: [{ title: "Auditoria — Gestão e Análise de Dados" }] }),
  component: AuditoriaPage,
});

type AuditRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  username: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: any;
  user_agent: string | null;
};

const ACTION_LABEL: Record<string, { label: string; tone: string }> = {
  login_success: { label: "Entrou", tone: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" },
  login_fail:    { label: "Login falhou", tone: "bg-red-600/15 text-red-700 dark:text-red-400" },
  logout:        { label: "Saiu", tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  create:        { label: "Criou", tone: "bg-blue-600/15 text-blue-700 dark:text-blue-400" },
  update:        { label: "Editou", tone: "bg-amber-600/15 text-amber-700 dark:text-amber-400" },
  delete:        { label: "Excluiu", tone: "bg-red-600/15 text-red-700 dark:text-red-400" },
  import:        { label: "Importou", tone: "bg-violet-600/15 text-violet-700 dark:text-violet-400" },
  export:        { label: "Exportou", tone: "bg-cyan-600/15 text-cyan-700 dark:text-cyan-400" },
  view:          { label: "Acessou", tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
};

function AuditoriaPage() {
  const { can, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clearFn = useServerFn(clearAuditLog);
  const allowed = isAdmin || can("auditoria");

  useEffect(() => {
    if (!loading && !allowed) navigate({ to: "/", replace: true });
  }, [loading, allowed, navigate]);

  const [q, setQ] = useState("");
  const [action, setAction] = useState("__all");
  const [user, setUser] = useState("__all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [clearing, setClearing] = useState(false);
  const pageSize = 50;

  const dataQ = useQuery({
    queryKey: ["audit_log"],
    queryFn: async () => {
      const all: AuditRow[] = [];
      const chunk = 1000;
      let off = 0;
      for (;;) {
        const { data, error } = await (supabase as any)
          .from("audit_log")
          .select("*")
          .order("created_at", { ascending: false })
          .range(off, off + chunk - 1);
        if (error) throw error;
        const got = (data ?? []) as AuditRow[];
        all.push(...got);
        if (got.length < chunk) break;
        off += chunk;
        if (all.length >= 5000) break;
      }
      return all;
    },
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const rows = dataQ.data ?? [];
  const actions = useMemo(() => Array.from(new Set(rows.map((r) => r.action))).sort(), [rows]);
  const users = useMemo(() => Array.from(new Set(rows.map((r) => r.username).filter(Boolean))).sort() as string[], [rows]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const fromTs = from ? new Date(from).getTime() : null;
    const toTs = to ? new Date(to).getTime() + 86_400_000 : null;
    return rows.filter((r) => {
      if (action !== "__all" && r.action !== action) return false;
      if (user !== "__all" && r.username !== user) return false;
      const t = new Date(r.created_at).getTime();
      if (fromTs && t < fromTs) return false;
      if (toTs && t > toTs) return false;
      if (!ql) return true;
      const s = `${r.username ?? ""} ${describeAuditEvent(r)}`.toLowerCase();
      return s.includes(ql);
    });
  }, [rows, q, action, user, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  async function handleClear() {
    setClearing(true);
    try {
      const res = await clearFn();
      toast.success(`Histórico limpo (${res.deleted} eventos removidos).`);
      await qc.invalidateQueries({ queryKey: ["audit_log"] });
      setPage(0);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao limpar histórico.");
    } finally {
      setClearing(false);
    }
  }

  if (loading || !allowed) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Auditoria
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro simples de tudo o que cada usuário fez no sistema.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => dataQ.refetch()} disabled={dataQ.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${dataQ.isFetching ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={clearing || !rows.length}>
                  <Trash2 className="h-4 w-4 mr-1" /> Limpar histórico
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Limpar todo o histórico de auditoria?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Essa ação apaga <strong>todos os {rows.length} eventos</strong> registrados e não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClear} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Sim, limpar tudo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3 space-y-3">
          <div className="grid gap-2 md:grid-cols-5">
            <Input className="md:col-span-2" placeholder="Buscar por texto…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            <Select value={action} onValueChange={(v) => { setAction(v); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="Ação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todas ações</SelectItem>
                {actions.map((a) => <SelectItem key={a} value={a}>{ACTION_LABEL[a]?.label ?? a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={user} onValueChange={(v) => { setUser(v); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="Usuário" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todos usuários</SelectItem>
                {users.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-1">
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} de {rows.length} evento(s)
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {dataQ.isLoading ? (
            <div className="flex items-center justify-center p-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando histórico…
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="p-2.5 text-left w-44">Quando</th>
                    <th className="p-2.5 text-left w-32">Usuário</th>
                    <th className="p-2.5 text-left w-28">Ação</th>
                    <th className="p-2.5 text-left">O que aconteceu</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r) => {
                    const tone = ACTION_LABEL[r.action]?.tone ?? "bg-muted text-foreground";
                    return (
                      <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                        <td className="p-2.5 tabular-nums whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                        <td className="p-2.5 font-medium">{r.username ?? "—"}</td>
                        <td className="p-2.5"><span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>{ACTION_LABEL[r.action]?.label ?? r.action}</span></td>
                        <td className="p-2.5">{describeAuditEvent(r)}</td>
                      </tr>
                    );
                  })}
                  {!pageRows.length && (
                    <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">Nenhum evento encontrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 p-3 border-t border-border">
            <span className="text-xs text-muted-foreground">Página {safePage + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
