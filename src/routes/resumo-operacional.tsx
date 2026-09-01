import { createFileRoute } from "@tanstack/react-router";
import { ResumoView } from "@/components/resumo-view";

export const Route = createFileRoute("/resumo-operacional")({
  head: () => ({ meta: [{ title: "Resumo Operacional — Gestão e Análise de Dados" }] }),
  component: () => <ResumoView mode="grupo" />,
});
