import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CrudTable } from "@/components/crud-table";
import { fetchLinhas, fetchEmpresaEstacao } from "@/lib/data";
import { useAuditView } from "@/lib/use-audit-view";
import { useAcessoDados, MSG_SEM_ACESSO } from "@/lib/acesso";

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
  const acesso = useAcessoDados();
  // A exceção por estação DECIDE o Grupo/Empresa das viagens (e com isso
  // quem enxerga o quê) — usuário restrito só mexe em exceção do próprio
  // Grupo/Empresa, em linha que já é dele.
  const motivoBloqueio = (r: Record<string, any>) => {
    if (!acesso.restrito) return null;
    if (acesso.carregando) return "Ainda carregando o cadastro — aguarde um instante.";
    if (!acesso.podeValores(r.grupo, r.empresa)) return `Exceção de outro Grupo/Empresa. ${MSG_SEM_ACESSO}`;
    if (!acesso.podeLinha(r.linha)) return `Linha ${r.linha ?? "—"}: pertence a outro Grupo/Empresa. ${MSG_SEM_ACESSO}`;
    return null;
  };

  return (
    <CrudTable
      title="Empresa por Estação"
      description={'Exceção para linhas operadas por mais de uma empresa/grupo/unidade (ex.: linha "07" = Icaraí + Grupo Maua + Unidade Icaraí em alguns trechos, Tanguá + Grupo Rio Ita + Unidade Expresso Tanguá em outros). Cadastre a estação (origem OU destino) que identifica cada um. Grupo e Unidade são opcionais — deixe em branco pra essa estação usar o valor normal do Cadastro de Linhas.'}
      table="linha_empresa_estacao"
      pk="id"
      motivoBloqueio={motivoBloqueio}
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
        { key: "unidade", label: "Unidade (opcional)", sortable: true },
      ]}
    />
  );
}
