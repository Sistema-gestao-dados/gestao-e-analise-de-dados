import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchImportacoes } from "@/lib/data";
import { clearImportacoes } from "@/lib/admin-audit.functions";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { History, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAuditView } from "@/lib/use-audit-view";

export const Route = createFileRoute("/historico")({
  head: () => ({ meta: [{ title: "Histórico — Gestão e Análise de Dados" }] }),
  component: HistoricoPage,
});

function HistoricoPage() {
  useAuditView("historico");
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const clearFn = useServerFn(clearImportacoes);
  const [clearing, setClearing] = useState(false);
  const q = useQuery({ queryKey: ["importacoes"], queryFn: fetchImportacoes });
  const items = q.data ?? [];

  async function handleClear() {
    setClearing(true);
    try {
      const res = await clearFn();
      toast.success(`Histórico limpo (${res.deleted} registros removidos).`);
      await qc.invalidateQueries({ queryKey: ["importacoes"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao limpar histórico.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Histórico de Importações</h1>
          <p className="text-sm text-muted-foreground">Auditoria de todas as cargas processadas no sistema.</p>
        </div>
        {isAdmin && items.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={clearing}>
                <Trash2 className="h-4 w-4 mr-1" /> Limpar histórico
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Limpar todo o histórico de importações?</AlertDialogTitle>
                <AlertDialogDescription>
                  Essa ação apaga <strong>todos os {items.length} registros</strong> de importações. Os dados importados nas tabelas permanecem intactos — apenas o log é removido.
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
      <Card className="shadow-[var(--shadow-card)] overflow-hidden">
        {items.length === 0 ? (
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <History className="h-8 w-8 mx-auto mb-2 opacity-50" />Nenhuma importação registrada.
          </CardContent>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left p-3">Data</th>
                <th className="text-left p-3">Tipo</th>
                <th className="text-left p-3">Arquivo</th>
                <th className="text-right p-3">Inseridos</th>
                <th className="text-right p-3">Atualizados</th>
                <th className="text-right p-3">Erros</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-border hover:bg-muted/50">
                  <td className="p-3 text-muted-foreground">{new Date(i.created_at).toLocaleString("pt-BR")}</td>
                  <td className="p-3 font-medium">{i.tipo}</td>
                  <td className="p-3 text-muted-foreground">{i.arquivo ?? "—"}</td>
                  <td className="p-3 text-right tabular-nums text-success">{i.registros_inseridos}</td>
                  <td className="p-3 text-right tabular-nums text-primary">{i.registros_atualizados}</td>
                  <td className="p-3 text-right tabular-nums text-destructive">{i.registros_erro}</td>
                  <td className="p-3">{i.registros_erro > 0 ? <Badge variant="destructive">Com erros</Badge> : <Badge variant="secondary">Sucesso</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
