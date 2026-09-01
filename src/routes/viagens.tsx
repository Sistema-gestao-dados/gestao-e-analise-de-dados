import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchProjetosAtivos, filterViagensAtivas } from "@/lib/projeto-ativo";
import { CrudTable, type ColumnDef } from "@/components/crud-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { usePersistentState } from "@/hooks/use-persistent-state";

export const Route = createFileRoute("/viagens")({
  head: () => ({ meta: [{ title: "Viagens — Gestão e Análise de Dados" }] }),
  component: ViagensPage,
});

const COLUMNS: ColumnDef[] = [
  { key: "linha", label: "Linha", required: true },
  { key: "tipo_operacao", label: "Tipo Op.", type: "select", options: () => ["Dias Úteis", "Sábado", "Domingo"] },
  { key: "versao_programacao", label: "Versão" },
  { key: "tipo_servico", label: "Tipo Serv.", type: "select", options: () => ["TU", "DIR"], width: "100px" },
  { key: "servico", label: "Serviço", width: "90px" },
  { key: "carro", label: "Carro", width: "90px" },
  { key: "turno", label: "Turno", width: "80px" },
  { key: "origem", label: "Origem" },
  { key: "destino", label: "Destino" },
  { key: "tipo_movimento", label: "Movimento", type: "select", options: () => ["Soltura", "Comercial", "Recolha"] },
  { key: "categoria_movimento", label: "Categoria", type: "select", options: () => ["Deslocamento", "Viagem"] },
  { key: "sentido", label: "Sentido", type: "select", options: () => ["Ida", "Volta"], width: "90px" },
  { key: "partida", label: "Partida", width: "90px" },
  { key: "chegada", label: "Chegada", width: "90px" },
  { key: "tempo_viagem", label: "Tempo", width: "90px" },
  { key: "arquivo", label: "Arquivo" },
];

function exportXLSX(rows: any[]) {
  const data = rows.map((r) => Object.fromEntries(COLUMNS.map((c) => [c.label, r[c.key] ?? ""])));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Viagens");
  XLSX.writeFile(wb, `viagens_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportPDF(rows: any[]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(12);
  doc.text(`Viagens — ${rows.length} registro(s)`, 14, 12);
  autoTable(doc, {
    startY: 16,
    head: [COLUMNS.map((c) => c.label)],
    body: rows.map((r) => COLUMNS.map((c) => String(r[c.key] ?? ""))),
    styles: { fontSize: 7 },
    headStyles: { fillColor: [37, 99, 235] },
  });
  doc.save(`viagens_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function ViagensPage() {
  useAuditView("viagens");
  const [somenteAtivos, setSomenteAtivos] = usePersistentState("viagens.somenteAtivos", true);
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });
  const ativos = ativosQ.data ?? [];

  // Chaves ativas: "linha||tipo_operacao" -> versao_programacao
  const ativosKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of ativos) m.set(`${a.linha}||${a.tipo_operacao}`, a.versao_programacao);
    return m;
  }, [ativos]);

  const clientFilter = useMemo(() => {
    if (!somenteAtivos || !ativos.length) return undefined;
    return (r: any) => {
      const key = `${r.linha}||${r.tipo_operacao ?? ""}`;
      const v = ativosKey.get(key);
      if (!v) return true;
      return r.versao_programacao === v;
    };
  }, [somenteAtivos, ativos.length, ativosKey]);

  return (
    <div className="space-y-4">
      <CrudTable
        title="Viagens"
        description="Registros importados de arquivos TXT (GPS). Filtre, pesquise e exclua em massa."
        table="viagens"
        pk="id"
        queryKey="viagens"
        columns={COLUMNS}
        filters={[]}
        clientFilter={clientFilter}
        initialPageSize={50}
        toolbarExtras={({ filteredRows }) => (
          <>
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none mr-2">
              <Checkbox checked={somenteAtivos} onCheckedChange={(v) => setSomenteAtivos(!!v)} />
              Somente ativas
            </label>
            <Button variant="outline" size="sm" onClick={() => { exportXLSX(filteredRows); void logAudit({ action: "export", entity: "viagens", details: { format: "xlsx", count: filteredRows.length } }); }} disabled={!filteredRows.length}>
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => { exportPDF(filteredRows); void logAudit({ action: "export", entity: "viagens", details: { format: "pdf", count: filteredRows.length } }); }} disabled={!filteredRows.length}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
          </>
        )}
      />
    </div>
  );
}

