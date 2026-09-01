import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CrudTable } from "@/components/crud-table";
import { fetchLinhas } from "@/lib/data";
import { useAuditView } from "@/lib/use-audit-view";

export const Route = createFileRoute("/cadastro-km")({
  head: () => ({ meta: [{ title: "Cadastro de KM — Gestão e Análise de Dados" }] }),
  component: KmCadastro,
});

function KmCadastro() {
  useAuditView("cadastro_km");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const linhas = linhasQ.data ?? [];

  return (
    <CrudTable
      title="Cadastro de KM"
      description="Origem, destino, quilometragem e descrição/itinerário de cada trecho operacional."
      table="parametro_km"
      pk="id"
      queryKey="km"
      filters={[
        { key: "linha", label: "Linha", options: () => Array.from(new Set(linhas.map((l) => l.linha))).sort() },
      ]}
      columns={[
        { key: "linha", label: "Linha", required: true, sortable: true, width: "100px" },
        { key: "origem", label: "Origem", required: true },
        { key: "destino", label: "Destino", required: true },
        { key: "km", label: "KM", type: "number", required: true, align: "right", format: (v) => v != null ? Number(v).toFixed(2) + " km" : "—" },
        { key: "descricao", label: "Descrição / Itinerário" },
      ]}
    />
  );
}
