import { createFileRoute } from "@tanstack/react-router";
import { ResumoView } from "@/components/resumo-view";

export const Route = createFileRoute("/resumo-linha")({
  head: () => ({ meta: [{ title: "Resumo por Linha — Gestão e Análise de Dados" }] }),
  component: () => <ResumoView mode="linha" />,
});
