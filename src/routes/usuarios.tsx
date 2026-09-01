import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, ShieldCheck, ShieldOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { adminCreateUser, adminDeleteUser, adminListUsers, adminUpdateUser } from "@/lib/admin.functions";

export const Route = createFileRoute("/usuarios")({
  component: UsuariosPage,
});

type ListItem = { id: string; email: string; nome: string; ativo: boolean; isAdmin: boolean; created_at: string };
type FormState = {
  id?: string;
  email: string;
  nome: string;
  password: string;
  isAdmin: boolean;
  ativo: boolean;
};
const empty: FormState = { email: "", nome: "", password: "", isAdmin: false, ativo: true };

function UsuariosPage() {
  const { isAdmin, user: current, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<ListItem | null>(null);

  const listFn = useServerFn(adminListUsers);
  const createFn = useServerFn(adminCreateUser);
  const updateFn = useServerFn(adminUpdateUser);
  const deleteFn = useServerFn(adminDeleteUser);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/", replace: true });
    if (!loading && isAdmin) void logAudit({ action: "view", entity: "users", details: { page: "usuarios" } });
  }, [loading, isAdmin, navigate]);

  const { data: users = [], isLoading } = useQuery<ListItem[]>({
    queryKey: ["admin_users"],
    queryFn: async () => (await listFn()) as ListItem[],
    enabled: !loading && isAdmin,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.email} ${u.nome}`.toLowerCase().includes(q));
  }, [users, search]);

  const saveMut = useMutation({
    mutationFn: async (f: FormState) => {
      if (f.id) {
        await updateFn({
          data: {
            userId: f.id,
            nome: f.nome.trim(),
            ativo: f.ativo,
            isAdmin: f.isAdmin,
            password: f.password ? f.password : undefined,
          },
        });
        void logAudit({ action: "update", entity: "users", entity_id: f.id, details: { email: f.email, isAdmin: f.isAdmin, ativo: f.ativo, password_changed: !!f.password } });
      } else {
        if (!f.password) throw new Error("Senha obrigatória para novo usuário");
        await createFn({ data: { email: f.email.trim(), password: f.password, nome: f.nome.trim(), isAdmin: f.isAdmin } });
        void logAudit({ action: "create", entity: "users", details: { email: f.email, isAdmin: f.isAdmin } });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_users"] });
      setOpen(false);
      setForm(empty);
      toast.success("Usuário salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const target = users.find((u) => u.id === id);
      await deleteFn({ data: { userId: id } });
      void logAudit({ action: "delete", entity: "users", entity_id: id, details: { email: target?.email } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_users"] });
      setToDelete(null);
      toast.success("Usuário excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startNew = () => { setForm(empty); setOpen(true); };
  const startEdit = (u: ListItem) => {
    setForm({ id: u.id, email: u.email, nome: u.nome, password: "", isAdmin: u.isAdmin, ativo: u.ativo });
    setOpen(true);
  };

  if (loading || !isAdmin) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground">Contas com acesso ao sistema. Autenticação segura via Supabase.</p>
        </div>
        <Button onClick={startNew}><Plus className="h-4 w-4 mr-1" /> Novo usuário</Button>
      </div>

      <Card className="p-4">
        <Input
          placeholder="Buscar por e-mail ou nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm mb-4"
        />
        {isLoading ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" />Carregando…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">E-mail</th>
                  <th className="py-2 pr-3">Nome</th>
                  <th className="py-2 pr-3">Perfil</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="py-2 pr-3 font-medium">{u.email}</td>
                    <td className="py-2 pr-3">{u.nome}</td>
                    <td className="py-2 pr-3">
                      {u.isAdmin
                        ? <Badge className="bg-primary"><ShieldCheck className="h-3 w-3 mr-1" />Admin</Badge>
                        : <Badge variant="secondary"><ShieldOff className="h-3 w-3 mr-1" />Usuário</Badge>}
                    </td>
                    <td className="py-2 pr-3">
                      {u.ativo ? <Badge variant="outline" className="text-green-600 border-green-600/40">Ativo</Badge> : <Badge variant="outline" className="text-muted-foreground">Inativo</Badge>}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(u)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" disabled={u.id === current?.id} onClick={() => setToDelete(u)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nenhum usuário encontrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Editar usuário" : "Novo usuário"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <Label>E-mail *</Label>
                <Input type="email" value={form.email} disabled={!!form.id} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Nome completo *</Label>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{form.id ? "Nova senha (deixe vazio p/ manter)" : "Senha *"}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <p className="text-xs text-muted-foreground">Mínimo 6 caracteres. Senhas vazadas (HIBP) são bloqueadas.</p>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">Administrador</div>
                <div className="text-xs text-muted-foreground">Acesso a Usuários e Auditoria</div>
              </div>
              <Switch checked={form.isAdmin} onCheckedChange={(v) => setForm({ ...form, isAdmin: v })} disabled={form.id === current?.id} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <div className="text-sm font-medium">Ativo</div>
                <div className="text-xs text-muted-foreground">Usuários inativos são bloqueados no login</div>
              </div>
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} disabled={form.id === current?.id} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending || !form.email || !form.nome}>
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário <strong>{toDelete?.email}</strong> será removido definitivamente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && delMut.mutate(toDelete.id)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
