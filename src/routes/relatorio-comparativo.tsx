import { createFileRoute } from "@tanstack/react-router";
import { ComparativoView } from "@/components/comparativo-view";
import { useAuditView } from "@/lib/use-audit-view";

function ComparativoPage() {
  useAuditView("relatorio_comparativo");
  return <ComparativoView />;
}

export const Route = createFileRoute("/relatorio-comparativo")({
  head: () => ({
    meta: [
      { title: "Relatório Comparativo — Gestão e Análise de Dados" },
      { name: "description", content: "Compare duas programações lado a lado com diferença absoluta e percentual." },
    ],
  }),
  component: ComparativoPage,
});
