import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchHistorico, buildGrupoParaLinhas, type Historico } from "@/lib/historico";
import { fetchLinhas, fetchMulti } from "@/lib/data";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileDown, Filter, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/historico-relatorio")({
  head: () => ({ meta: [{ title: "Relatório PDF — Histórico de Reprogramação" }] }),
  component: RelatorioPage,
});

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

function RelatorioPage() {
  useAuditView("historico_reprogramacao_relatorio");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const historicoQ = useQuery({ queryKey: ["historico-reprogramacao"], queryFn: fetchHistorico });

  const linhas = linhasQ.data ?? [];
  const multi = multiQ.data ?? [];
  const historico = historicoQ.data ?? [];

  const empresaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l.empresa])), [linhas]);
  const grupoParaLinhas = useMemo(() => buildGrupoParaLinhas(multi), [multi]);

  const [filtros, setFiltros] = useState({ linha: "__all", empresa: "__all", grupo: "__all", dia_tipo: "__all", ano: "__all", ativo: "__all" });

  const opts = useMemo(() => ({
    linha: Array.from(new Set(historico.map((h) => h.linha))).sort(),
    empresa: Array.from(new Set(linhas.map((l) => l.empresa).filter(Boolean) as string[])).sort(),
    grupo: Array.from(grupoParaLinhas.keys()).sort(),
    diaTipo: Array.from(new Set(historico.map((h) => h.dia_tipo).filter(Boolean) as string[])).sort(),
    ano: Array.from(new Set(historico.map((h) => h.vigencia?.slice(0, 4)).filter(Boolean) as string[])).sort().reverse(),
  }), [historico, linhas, grupoParaLinhas]);

  const filtered = useMemo(() => {
    return historico.filter((h) => {
      if (filtros.linha !== "__all" && h.linha !== filtros.linha) return false;
      if (filtros.dia_tipo !== "__all" && h.dia_tipo !== filtros.dia_tipo) return false;
      if (filtros.ativo === "S" && !h.ativo) return false;
      if (filtros.ativo === "N" && h.ativo) return false;
      if (filtros.empresa !== "__all" && empresaMap.get(h.linha) !== filtros.empresa) return false;
      if (filtros.grupo !== "__all" && !grupoParaLinhas.get(filtros.grupo)?.has(h.linha)) return false;
      if (filtros.ano !== "__all" && !h.vigencia?.startsWith(filtros.ano)) return false;
      return true;
    });
  }, [historico, filtros, empresaMap, grupoParaLinhas]);

  function resumoFiltros(): string[] {
    const out: string[] = [];
    if (filtros.linha !== "__all") out.push(`Linha: ${filtros.linha}`);
    if (filtros.empresa !== "__all") out.push(`Empresa: ${filtros.empresa}`);
    if (filtros.grupo !== "__all") out.push(`Grupo: ${filtros.grupo}`);
    if (filtros.dia_tipo !== "__all") out.push(`Dia tipo: ${filtros.dia_tipo}`);
    if (filtros.ano !== "__all") out.push(`Ano: ${filtros.ano}`);
    if (filtros.ativo !== "__all") out.push(`Ativo: ${filtros.ativo === "S" ? "Sim" : "Não"}`);
    return out.length ? out : ["Nenhum filtro aplicado"];
  }

  async function gerarPDF() {
    if (filtered.length === 0) { toast.error("Nenhum registro para exportar"); return; }
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 36;

      doc.setFillColor(30, 41, 59);
      doc.rect(0, 0, pageW, 70, "F");
      doc.setTextColor(255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Relatório de Reprogramações", margin, 32);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, margin, 50);
      doc.text(`${filtered.length} registro(s)`, pageW - margin, 50, { align: "right" });

      const filtrosList = resumoFiltros();
      doc.setTextColor(30, 41, 59);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Filtros aplicados", margin, 100);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, 106, pageW - margin, 106);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(60);
      const colW = (pageW - margin * 2) / 3;
      filtrosList.forEach((linha, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        doc.text(`• ${linha}`, margin + col * colW, 122 + row * 14);
      });
      const linhasUsadas = Math.ceil(filtrosList.length / 3);
      const startY = 122 + linhasUsadas * 14 + 14;

      const cleanText = (s?: string | null) => {
        if (!s) return "—";
        return String(s).replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
      };

      autoTable(doc, {
        startY,
        margin: { left: margin, right: margin },
        head: [["Linha", "Versão", "Dia tipo", "Vigência", "Encerramento", "Alteração"]],
        body: filtered.map((h) => [h.linha, h.versao ?? "—", h.dia_tipo ?? "—", fmtDate(h.vigencia), fmtDate(h.encerramento), cleanText(h.alteracao)]),
        styles: { fontSize: 9, cellPadding: 6, valign: "top", lineColor: [226, 232, 240], lineWidth: 0.5, overflow: "linebreak" },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold", halign: "left", overflow: "linebreak", cellPadding: { top: 6, right: 4, bottom: 6, left: 6 } },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" }, 1: { cellWidth: 55, halign: "center" }, 2: { cellWidth: 70 }, 3: { cellWidth: 70, halign: "center" }, 4: { cellWidth: 90, halign: "center" }, 5: { cellWidth: "auto", overflow: "linebreak" } },
        didDrawPage: (d: any) => {
          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text(`Página ${d.pageNumber} de ${doc.getNumberOfPages()}`, pageW - margin, pageH - 16, { align: "right" });
          doc.text("Histórico de Reprogramações", margin, pageH - 16);
        },
      });

      const ts = new Date().toISOString().slice(0, 10);
      doc.save(`relatorio-reprogramacoes-${ts}.pdf`);
      void logAudit({ action: "export", entity: "historico_reprogramacao", details: { total: filtered.length, filtros } });
      toast.success("PDF gerado");
    } catch (e) {
      toast.error("Erro ao gerar PDF", { description: (e as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2"><Link to="/historico-consultar"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Relatório de Reprogramações</h1>
          <CardDescription>Filtre e exporte um PDF formatado do histórico.</CardDescription>
        </div>
        <Button onClick={gerarPDF}><FileDown className="h-4 w-4 mr-1" /> Exportar PDF</Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Filtros</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <FiltroSelect label="Linha" value={filtros.linha} onChange={(v) => setFiltros((f) => ({ ...f, linha: v }))} options={opts.linha} />
          <FiltroSelect label="Empresa" value={filtros.empresa} onChange={(v) => setFiltros((f) => ({ ...f, empresa: v }))} options={opts.empresa} />
          <FiltroSelect label="Grupo" value={filtros.grupo} onChange={(v) => setFiltros((f) => ({ ...f, grupo: v }))} options={opts.grupo} />
          <FiltroSelect label="Dia Tipo" value={filtros.dia_tipo} onChange={(v) => setFiltros((f) => ({ ...f, dia_tipo: v }))} options={opts.diaTipo} />
          <FiltroSelect label="Ano" value={filtros.ano} onChange={(v) => setFiltros((f) => ({ ...f, ano: v }))} options={opts.ano} />
          <FiltroSelect label="Ativo" value={filtros.ativo} onChange={(v) => setFiltros((f) => ({ ...f, ativo: v }))} options={["S", "N"]} />
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Linha</TableHead><TableHead>Versão</TableHead><TableHead>Dia Tipo</TableHead><TableHead>Vigência</TableHead><TableHead>Encerramento</TableHead><TableHead>Alteração</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map((h: Historico) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{h.linha}</TableCell>
                  <TableCell>{h.versao ?? "—"}</TableCell>
                  <TableCell>{h.dia_tipo ?? "—"}</TableCell>
                  <TableCell>{fmtDate(h.vigencia)}</TableCell>
                  <TableCell>{fmtDate(h.encerramento)}</TableCell>
                  <TableCell className="max-w-md truncate">{h.alteracao ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length > 200 && <p className="p-3 text-xs text-muted-foreground">Mostrando 200 de {filtered.length} — o PDF exporta todos.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function FiltroSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="__all">Todos</SelectItem>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
