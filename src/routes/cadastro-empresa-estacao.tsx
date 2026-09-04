import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CrudTable } from "@/components/crud-table";
import { fetchLinhas, fetchEmpresaEstacao } from "@/lib/data";
import { useAuditView } from "@/lib/use-audit-view";

export const Route = createFileRoute("/cadastro-empresa-estacao")({
  head: () => ({ meta: [{ title: "Empresa por Estação — Gestão e Análise de Dados" }] }),
  component: EmpresaEstacaoCadastro,
});

function EmpresaEstacaoCadastro() {
  useAuditView("cadastro_empresa_estacao");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const empresaEstacaoQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  const linhas = linhasQ.data ?? [];
  const rows = empresaEstacaoQ.data ?? [];

  return (
    <CrudTable
      title="Empresa por Estação"
      description={'Exceção para linhas operadas por mais de uma empresa/grupo (ex.: linha "07" = Icaraí + Grupo Maua em alguns trechos, Tanguá + Grupo Rio Ita em outros). Cadastre a estação (origem OU destino) que identifica cada um. O campo Grupo é opcional — deixe em branco pra essa estação usar o Grupo normal do Cadastro de Linhas.'}
      table="linha_empresa_estacao"
      pk="id"
      queryKey="empresa-estacao"
      filters={[
        { key: "linha", label: "Linha", options: () => Array.from(new Set(linhas.map((l) => l.linha))).sort() },
        { key: "empresa", label: "Empresa", options: () => Array.from(new Set(rows.map((r) => r.empresa).filter(Boolean))).sort() },
      ]}
      columns={[
        { key: "linha", label: "Linha", required: true, sortable: true, width: "120px" },
        { key: "estacao", label: "Estação (origem ou destino)", required: true, sortable: true },
        { key: "empresa", label: "Empresa", required: true, sortable: true },
        { key: "grupo", label: "Grupo (opcional)", sortable: true },
      ]}
    />
  );
}
