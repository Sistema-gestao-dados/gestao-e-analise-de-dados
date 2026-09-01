import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CrudTable } from "@/components/crud-table";
import { fetchLinhas, fetchMulti } from "@/lib/data";
import { useAuditView } from "@/lib/use-audit-view";

export const Route = createFileRoute("/cadastro-grupos")({
  head: () => ({ meta: [{ title: "Cadastro de Grupos — Gestão e Análise de Dados" }] }),
  component: GruposCadastro,
});

function GruposCadastro() {
  useAuditView("cadastro_grupos");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const linhas = linhasQ.data ?? [];
  const multi = multiQ.data ?? [];

  return (
    <CrudTable
      title="Cadastro de Grupos de Linhas"
      description="Agrupamentos multilinha por tipo de dia."
      table="parametro_multilinha"
      pk="id"
      queryKey="multi"
      filters={[
        { key: "linha", label: "Linha", options: () => Array.from(new Set(linhas.map((l) => l.linha))).sort() },
        { key: "tipo_dia", label: "Tipo de Dia", options: () => Array.from(new Set(multi.map((m) => m.tipo_dia).filter(Boolean))).sort() },
      ]}
      columns={[
        { key: "linha", label: "Linha", required: true, sortable: true, width: "120px" },
        { key: "grupo_du", label: "Grupo D.U.", required: true, sortable: true },
        { key: "tipo_dia", label: "Tipo de Dia", required: true, sortable: true },
      ]}
    />
  );
}
