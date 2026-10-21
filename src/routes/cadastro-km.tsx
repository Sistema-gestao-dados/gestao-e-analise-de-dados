import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CrudTable } from "@/components/crud-table";
import { fetchLinhas } from "@/lib/data";
import { useAuditView } from "@/lib/use-audit-view";
import { useAcessoDados, MSG_SEM_ACESSO } from "@/lib/acesso";

export const Route = createFileRoute("/cadastro-km")({
  head: () => ({ meta: [{ title: "Cadastro de KM — Gestão e Análise de Dados" }] }),
  component: KmCadastro,
});

function KmCadastro() {
  useAuditView("cadastro_km");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const linhas = linhasQ.data ?? [];
  const acesso = useAcessoDados();
  // Usuário com acesso restrito só grava registros de linha do próprio
  // Grupo/Empresa (o cadastro é compartilhado entre todos os grupos).
  const motivoBloqueio = (r: Record<string, any>) => {
    if (!acesso.restrito) return null;
    if (acesso.carregando) return "Ainda carregando o cadastro — aguarde um instante.";
    return acesso.podeLinha(r.linha) ? null : `Linha ${r.linha ?? "—"}: pertence a outro Grupo/Empresa. ${MSG_SEM_ACESSO}`;
  };

  return (
    <CrudTable
      title="Cadastro de KM"
      description="Origem, destino, quilometragem e descrição/itinerário de cada trecho operacional."
      table="parametro_km"
      pk="id"
      motivoBloqueio={motivoBloqueio}
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
