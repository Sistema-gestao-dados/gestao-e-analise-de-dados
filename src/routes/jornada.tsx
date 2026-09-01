import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { fetchLinhas } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import { fetchProjetosAtivos, filterViagensAtivas } from "@/lib/projeto-ativo";
import { buildJornadas, jornadaTotais, fmtDur, LIMITE_DIR_MIN, LIMITE_TU_MIN, type JornadaServico } from "@/lib/jornada";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MultiSelect } from "@/components/multi-select";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, AlertTriangle, TrendingUp, Users, Timer, FileSpreadsheet, FileText, Printer, Download } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PdfPreviewDialog, type PdfOrientation } from "@/components/pdf-preview-dialog";
import { usePersistentState } from "@/hooks/use-persistent-state";

export const Route = createFileRoute("/jornada")({
  head: () => ({
    meta: [
      { title: "Jornada de Trabalho — Gestão e Análise de Dados" },
      { name: "description", content: "Indicadores de jornada, horas extras e alertas de sobrecarga por serviço/motorista." },
    ],
  }),
  component: JornadaPage,
});

function Kpi({ label, value, icon: Icon, tone = "primary", onClick }: any) {
  const map: any = {
    primary: "bg-primary/10 text-primary ring-primary/20",
    warning: "bg-warning/10 text-warning ring-warning/20",
    danger: "bg-destructive/10 text-destructive ring-destructive/20",
    success: "bg-success/10 text-success ring-success/20",
  };
  return (
    <Card className={`shadow-[var(--shadow-card)] ${onClick ? "cursor-pointer hover:shadow-md transition" : ""}`} onClick={onClick}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-md ring-1 flex items-center justify-center ${map[tone]}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function JornadaPage() {
  useAuditView("jornada");
  const [fDia, setFDia] = usePersistentState("jornada.fDia", "__all");
  const [fVersao, setFVersao] = usePersistentState("jornada.fVersao", "__all");
  const [fTipo, setFTipo] = usePersistentState("jornada.fTipo", "__all");
  const [fLinha, setFLinha] = usePersistentState<string[]>("jornada.fLinha", []);
  const [modal, setModal] = useState<null | "7" | "9" | "he">(null);
  const [somenteAtivos, setSomenteAtivos] = usePersistentState("jornada.somenteAtivos", true);
  type Snap = { dia: string; versao: string; tipo: string; linha: string[] };
  // Aplica filtros automaticamente ao abrir (usa cache se houver, sem recarregar)
  const [applied, setApplied] = useState<Snap | null>({ dia: "__all", versao: "__all", tipo: "__all", linha: [] });

  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });
  const viagensRaw = viagensQ.data ?? [];
  const linhas = linhasQ.data ?? [];
  const ativos = ativosQ.data ?? [];
  const viagens = useMemo(
    () => (somenteAtivos ? filterViagensAtivas(viagensRaw, ativos) : viagensRaw),
    [viagensRaw, ativos, somenteAtivos],
  );


  const opts = useMemo(() => ({
    dia: Array.from(new Set(viagens.map((v) => v.tipo_operacao).filter(Boolean) as string[])).sort(),
    versao: Array.from(new Set(viagens.map((v) => v.versao_programacao).filter(Boolean) as string[])).sort(),
    linha: Array.from(new Set(viagens.map((v) => v.linha).filter(Boolean))).sort(),
  }), [viagens]);

  const filtered = useMemo(() => {
    if (!applied) return [];
    const set = new Set(applied.linha);
    return viagens.filter((v) => {
      if (applied.dia !== "__all" && v.tipo_operacao !== applied.dia) return false;
      if (applied.versao !== "__all" && v.versao_programacao !== applied.versao) return false;
      if (set.size && !set.has(v.linha)) return false;
      return true;
    });
  }, [viagens, applied]);

  const jornadas = useMemo(() => {
    if (!applied) return [];
    const all = buildJornadas(filtered, linhas);
    if (applied.tipo === "__all") return all;
    if (applied.tipo === "TU") return all.filter((j) => j.tipoServico === "TU");
    if (applied.tipo === "DIR") return all.filter((j) => j.tipoServico === "DIR");
    return all;
  }, [applied, filtered, linhas]);

  const totais = useMemo(() => jornadaTotais(jornadas), [jornadas]);

  const listaModal = useMemo((): JornadaServico[] => {
    if (!modal) return [];
    if (modal === "7") return jornadas.filter((j) => j.acimaDe7h && !j.acimaDe9h);
    if (modal === "9") return jornadas.filter((j) => j.acimaDe9h);
    return jornadas.filter((j) => j.horasExtras > 0);
  }, [jornadas, modal]);

  function exportModalXLSX() {
    const nome = modal === "9" ? "acima_10h_critico" : modal === "7" ? "acima_9h" : "horas_extras";
    const rows = listaModal.map((j) => ({
      Versao: j.versao,
      Linha: j.linha,
      Tipo: j.tipoServico,
      Servico: j.servico,
      Turnos: j.turnos.map((t) => `T${t.turno} ${t.primeiraPartida}->${t.ultimaChegada}`).join(" | "),
      "Jornada (h:mm)": fmtDur(j.minutosTotal),
      "Horas Extras": fmtDur(j.horasExtras),
      Alerta: j.acimaDe9h ? ">10h" : j.acimaDe7h ? ">9h" : "OK",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Jornada");
    XLSX.writeFile(wb, `jornada_${nome}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    void logAudit({ action: "export", entity: "jornada", details: { format: "xlsx", filtro: nome, rows: rows.length } });
  }

  function exportXLSX() {
    const wb = XLSX.utils.book_new();
    const rows = jornadas.map((j) => ({
      Versao: j.versao,
      Linha: j.linha,
      Tipo: j.tipoServico,
      Servico: j.servico,
      Turnos: j.turnos.map((t) => `T${t.turno}`).join("+"),
      "Início": j.turnos.map((t) => `T${t.turno} ${String(Math.floor(((t.inicioMin%1440)+1440)%1440/60)).padStart(2,"0")}:${String(((t.inicioMin%1440)+1440)%1440%60).padStart(2,"0")}`).join(" | "),
      "Fim": j.turnos.map((t) => `T${t.turno} ${String(Math.floor(((t.fimMin%1440)+1440)%1440/60)).padStart(2,"0")}:${String(((t.fimMin%1440)+1440)%1440%60).padStart(2,"0")}`).join(" | "),
      "Jornada (h:mm)": fmtDur(j.minutosTotal),
      "Horas Extras": fmtDur(j.horasExtras),
      "> 9h": j.acimaDe7h ? "Sim" : "",
      "> 10h": j.acimaDe9h ? "Sim" : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Jornada");
    XLSX.writeFile(wb, `jornada_${new Date().toISOString().slice(0, 10)}.xlsx`);
    void logAudit({ action: "export", entity: "jornada", details: { format: "xlsx", rows: jornadas.length } });
  }

  function buildPDF(orientation: PdfOrientation) {
    const probe = new jsPDF({ orientation, unit: "mm", format: "a4" });
    const pageW = probe.internal.pageSize.getWidth();
    const pageH = probe.internal.pageSize.getHeight();
    const HEADER_H = 18;
    const usableW = pageW - 20;
    const usableH = pageH - (HEADER_H + 3) - 12;

    const periodo = [
      applied?.dia && applied.dia !== "__all" ? applied.dia : "Todos os dias",
      applied?.versao && applied.versao !== "__all" ? `Versão ${applied.versao}` : null,
      applied?.tipo && applied.tipo !== "__all" ? `Tipo ${applied.tipo}` : null,
    ].filter(Boolean).join(" · ");
    const kpiTxt = `Jornadas ${totais.totalJornadas.toLocaleString("pt-BR")}  ·  Jornada total ${fmtDur(totais.minutosTotal)}  ·  ` +
      `Horas extras ${fmtDur(totais.horasExtrasTotal)}  ·  Acima de 9h ${totais.acimaDe7h}  ·  Acima de 10h (crítico) ${totais.acimaDe9h}`;

    function drawHeader(d: InstanceType<typeof jsPDF>) {
      d.setTextColor(37, 99, 235); d.setFont("helvetica", "bold"); d.setFontSize(12);
      d.text("JORNADA DE TRABALHO", 10, 8);
      d.setFont("helvetica", "normal"); d.setFontSize(7); d.setTextColor(100);
      d.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, pageW - 10, 8, { align: "right" });
      d.setFontSize(6.8); d.setTextColor(90);
      d.text(`Período: ${periodo} — ${jornadas.length} serviço(s)`, 10, 13);
      d.setFontSize(6.8);
      d.text(kpiTxt, 10, 17);
      d.setDrawColor(37, 99, 235); d.setLineWidth(0.5);
      d.line(10, 19, pageW - 10, 19);
      d.setTextColor(20);
    }

    const bodyRows = jornadas.map((j) => [
      j.linha, j.tipoServico, j.servico,
      j.turnos.map((t) => `T${t.turno} ${t.primeiraPartida}→${t.ultimaChegada}`).join(" · "),
      fmtDur(j.minutosTotal),
      j.horasExtras > 0 ? fmtDur(j.horasExtras) : "—",
      j.acimaDe9h ? ">10h" : j.acimaDe7h ? ">9h" : "OK",
    ]);
    const footRow = ["TOTAL", "", "", `${jornadas.length} serviço(s)`, fmtDur(totais.minutosTotal), fmtDur(totais.horasExtrasTotal), ""];
    const headRow = ["Linha", "Tipo", "Serviço", "Turnos", "Jornada", "HE", "Alerta"];
    const TURNOS_COL = 3;
    const TURNOS_MAX_MM = 55;

    function naturalWidth(fontSize: number) {
      const padX = 2 * (fontSize / 7.5);
      probe.setFontSize(fontSize);
      let total = 0;
      for (let c = 0; c < headRow.length; c++) {
        let maxW = 0;
        const cells = [headRow[c], ...bodyRows.map((r) => r[c]), footRow[c]];
        for (const cell of cells) {
          probe.setFont("helvetica", c === 0 ? "bold" : "normal");
          const w = probe.getTextWidth(String(cell ?? ""));
          if (w > maxW) maxW = w;
        }
        if (c === TURNOS_COL) maxW = Math.min(maxW, TURNOS_MAX_MM);
        total += maxW + padX * 2;
      }
      return total;
    }

    function draw(zoom: number, marginLeft: number) {
      const d = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const fontSize = 7.5 * zoom;
      const padY = 1.4 * zoom;
      autoTable(d, {
        startY: HEADER_H + 3,
        head: [headRow],
        body: bodyRows,
        foot: [footRow],
        styles: { fontSize, cellPadding: padY, halign: "center", valign: "middle", lineColor: [180, 180, 180], lineWidth: 0.18, overflow: "linebreak" },
        columnStyles: {
          0: { halign: "left", fontStyle: "bold" },
          3: { halign: "left", cellWidth: TURNOS_MAX_MM * zoom },
          4: { fontStyle: "bold" },
        },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: fontSize + 0.5, halign: "center", fontStyle: "bold", cellPadding: padY + 0.3 * zoom },
        footStyles: { fillColor: [219, 234, 254], textColor: 20, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: marginLeft, right: 10, top: HEADER_H + 3, bottom: 12 },
        theme: "grid",
        tableWidth: "wrap",
        showFoot: "lastPage",
        rowPageBreak: "avoid",
        didDrawPage: () => drawHeader(d),
      });
      const totalHeight = (d as any).lastAutoTable.finalY - (HEADER_H + 3);
      return { doc: d, pages: d.getNumberOfPages(), totalHeight };
    }

    const MIN_ZOOM = 5 / 7.5;
    const baseW = naturalWidth(7.5);
    const baseline = draw(1, 10);
    const zoom = Math.max(MIN_ZOOM, Math.min(usableW / baseW, usableH / baseline.totalHeight));
    const finalW = naturalWidth(7.5 * zoom);
    const marginLeft = Math.max(6, (pageW - finalW) / 2);
    const final = draw(zoom, marginLeft);
    const doc2 = final.doc;

    const pages = doc2.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc2.setPage(i);
      doc2.setFontSize(7); doc2.setTextColor(120);
      doc2.text(`Página ${i} de ${pages}`, pageW - 10, pageH - 5, { align: "right" });
    }
    return doc2;
  }

  const loading = viagensQ.isLoading || linhasQ.isLoading;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Jornada de Trabalho</h1>
          <p className="text-sm text-muted-foreground">
            Cálculo por serviço/motorista usando antecipação e prestação de contas cadastradas por linha/turno.
            Limite jornada: DIR <strong>{fmtDur(LIMITE_DIR_MIN)}</strong> · TU <strong>{fmtDur(LIMITE_TU_MIN)}</strong>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportXLSX} disabled={!jornadas.length}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
          <PdfPreviewDialog
            build={buildPDF}
            filename={`jornada_${new Date().toISOString().slice(0, 10)}.pdf`}
            disabled={!jornadas.length}
            onDownload={(o) => void logAudit({ action: "export", entity: "jornada", details: { format: "pdf", orientation: o, rows: jornadas.length } })}
            onPrint={(o) => void logAudit({ action: "export", entity: "jornada", details: { format: "print", orientation: o, rows: jornadas.length } })}
          />
        </div>
      </div>

      {/* Visualização de impressão — some na tela normal, só aparece no
          diálogo de impressão do navegador (margens/escala/nº de páginas
          ajustados lá, com pré-visualização). */}
      <div className="print-only">
        <div style={{ fontWeight: 700, fontSize: "14pt", color: "#2563eb" }}>JORNADA DE TRABALHO</div>
        <div style={{ fontSize: "8pt", color: "#555", marginBottom: "6pt" }}>
          Gerado em {new Date().toLocaleString("pt-BR")} — {jornadas.length} serviço(s) · Jornadas {totais.totalJornadas.toLocaleString("pt-BR")}
          {" · "}Total {fmtDur(totais.minutosTotal)} · HE {fmtDur(totais.horasExtrasTotal)} · &gt;9h {totais.acimaDe7h} · &gt;10h {totais.acimaDe9h}
        </div>
        <table className="print-table">
          <thead>
            <tr><th>Linha</th><th>Tipo</th><th>Serviço</th><th>Turnos</th><th>Jornada</th><th>HE</th><th>Alerta</th></tr>
          </thead>
          <tbody>
            {jornadas.map((j) => (
              <tr key={`${j.vehicleKey}||${j.bucket}`}>
                <td style={{ textAlign: "left", fontWeight: 600 }}>{j.linha}</td>
                <td>{j.tipoServico}</td>
                <td>{j.servico}</td>
                <td style={{ textAlign: "left" }}>{j.turnos.map((t) => `T${t.turno} ${t.primeiraPartida}→${t.ultimaChegada}`).join(" · ")}</td>
                <td style={{ fontWeight: 600 }}>{fmtDur(j.minutosTotal)}</td>
                <td>{j.horasExtras > 0 ? fmtDur(j.horasExtras) : "—"}</td>
                <td>{j.acimaDe9h ? ">10h" : j.acimaDe7h ? ">9h" : "OK"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ textAlign: "left" }}>TOTAL</td>
              <td></td><td></td>
              <td style={{ textAlign: "left" }}>{jornadas.length} serviço(s)</td>
              <td>{fmtDur(totais.minutosTotal)}</td>
              <td>{fmtDur(totais.horasExtrasTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="print:hidden space-y-4">

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-3 flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dia tipo</label>
            <Select value={fDia} onValueChange={setFDia}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todos</SelectItem>
                {opts.dia.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Versão</label>
            <Select value={fVersao} onValueChange={setFVersao}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todas</SelectItem>
                {opts.versao.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo</label>
            <Select value={fTipo} onValueChange={setFTipo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todos</SelectItem>
                <SelectItem value="DIR">DIR</SelectItem>
                <SelectItem value="TU">TU</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <MultiSelect label="Linha" values={fLinha} onChange={setFLinha} options={opts.linha} placeholder="Todas" />
          <label className="flex items-end gap-2 text-xs cursor-pointer select-none pb-1">
            <Checkbox checked={somenteAtivos} onCheckedChange={(v) => setSomenteAtivos(!!v)} />
            Somente projetos ativos
          </label>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setApplied({ dia: fDia, versao: fVersao, tipo: fTipo, linha: fLinha })} disabled={viagensQ.isLoading || linhasQ.isLoading}>
              Consultar
            </Button>
            {applied && <Button variant="outline" size="sm" onClick={() => setApplied(null)}>Limpar</Button>}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Kpi label="Jornadas" value={totais.totalJornadas.toLocaleString("pt-BR")} icon={Users} />
        <Kpi label="Jornada total" value={fmtDur(totais.minutosTotal)} icon={Clock} tone="primary" />
        <Kpi label="Horas extras" value={fmtDur(totais.horasExtrasTotal)} icon={Timer} tone="warning" onClick={() => setModal("he")} />
        <Kpi label="Acima de 9h" value={totais.acimaDe7h} icon={TrendingUp} tone="warning" onClick={() => setModal("7")} />
        <Kpi label="Acima de 10h (crítico)" value={totais.acimaDe9h} icon={AlertTriangle} tone="danger" onClick={() => setModal("9")} />
      </div>

      {(totais.incompletas > 0 || totais.semCadastroLinha > 0) && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          {totais.incompletas > 0 && <span><strong>{totais.incompletas}</strong> TU incompleto(s) foram excluídos dos totais. </span>}
          {totais.semCadastroLinha > 0 && <span><strong>{totais.semCadastroLinha}</strong> jornada(s) estão sem parâmetros de antecipação/prestação da linha.</span>}
        </div>
      )}

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-2"><CardTitle className="text-base">Jornadas por serviço</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[70vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Serviço</TableHead>
                  <TableHead>Turnos</TableHead>
                  <TableHead className="text-right">Jornada</TableHead>
                  <TableHead className="text-right">HE</TableHead>
                  <TableHead className="text-center">Alerta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!applied && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Aplique os filtros e clique em <strong>Consultar</strong>.</TableCell></TableRow>}
                {applied && loading && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>}
                {!loading && jornadas.slice(0, 500).map((j) => (
                  <TableRow key={`${j.vehicleKey}||${j.bucket}`}>
                    <TableCell className="font-medium">{j.linha}</TableCell>
                    <TableCell><Badge variant="outline">{j.tipoServico}</Badge></TableCell>
                    <TableCell>{j.servico}</TableCell>
                    <TableCell className="text-xs">{j.turnos.map((t) => `T${t.turno} ${t.primeiraPartida}→${t.ultimaChegada}`).join(" · ")}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{fmtDur(j.minutosTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{j.horasExtras > 0 ? fmtDur(j.horasExtras) : "—"}</TableCell>
                    <TableCell className="text-center">
                      {j.acimaDe9h ? <Badge variant="destructive">&gt;10h</Badge>
                        : j.acimaDe7h ? <Badge className="bg-warning text-warning-foreground">&gt;9h</Badge>
                        : <span className="text-muted-foreground text-xs">OK</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && !jornadas.length && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Sem jornadas para os filtros atuais.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          {jornadas.length > 500 && <p className="text-xs text-muted-foreground p-3">Mostrando 500 de {jornadas.length}. Use os filtros para refinar.</p>}
        </CardContent>
      </Card>
      </div>

      <Dialog open={!!modal} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {modal === "9" && `Serviços acima de 10h — crítico (${listaModal.length})`}
              {modal === "7" && `Serviços entre 9h e 10h (${listaModal.length})`}
              {modal === "he" && `Serviços com horas extras (${listaModal.length})`}
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportModalXLSX} disabled={!listaModal.length}>
              <Download className="h-4 w-4 mr-2" />Exportar Excel
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Serviço</TableHead>
                  <TableHead>Turnos</TableHead>
                  <TableHead className="text-right">Jornada</TableHead>
                  <TableHead className="text-right">HE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listaModal.map((j) => (
                  <TableRow key={`${j.vehicleKey}||${j.bucket}`}>
                    <TableCell className="font-medium">{j.linha}</TableCell>
                    <TableCell>{j.tipoServico}</TableCell>
                    <TableCell>{j.servico}</TableCell>
                    <TableCell className="text-xs">{j.turnos.map((t) => `T${t.turno} ${t.primeiraPartida}→${t.ultimaChegada}`).join(" · ")}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{fmtDur(j.minutosTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{j.horasExtras > 0 ? fmtDur(j.horasExtras) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
