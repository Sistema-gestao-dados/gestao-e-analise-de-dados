import { createFileRoute } from "@tanstack/react-router";
import { AtivosManager } from "@/components/ativos-manager";
import { useAuditView } from "@/lib/use-audit-view";

export const Route = createFileRoute("/versoes-ativas")({
  head: () => ({ meta: [{ title: "Versões Ativas — Gestão e Análise de Dados" }] }),
  component: VersoesAtivasPage,
});

function VersoesAtivasPage() {
  useAuditView("projeto_ativo");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Versões Ativas</h1>
        <p className="text-sm text-muted-foreground">
          Defina a versão vigente por combinação Linha × Dia Tipo. Ao ativar uma linha de um grupo,
          as demais linhas do mesmo grupo são marcadas automaticamente.
        </p>
      </div>
      <AtivosManager />
    </div>
  );
}
