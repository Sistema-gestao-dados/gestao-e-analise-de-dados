import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { fetchLinhas, fetchEmpresaEstacao } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import { fetchProjetosAtivos, filterViagensAtivas } from "@/lib/projeto-ativo";
import { buildJornadas, jornadaTotais, fmtDur, LIMITE_DIR_MIN, LIMITE_TU_MIN, type JornadaServico, linhasParaJornada } from "@/lib/jornada";
import { buildEmpresaOverrideMap, resolveGrupoViagem, resolveEmpresaViagem, resolveUnidadeViagem, buildEmpresaPorServico, buildGrupoPorServico, buildUnidadePorServico } from "@/lib/empresa-estacao";
import { custoServico, fmtMoeda } from "@/lib/custo";
import { useParametrosCusto } from "@/components/salario-motorista";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MultiSelect } from "@/components/multi-select";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { useAcessoDados, cadastroParaOpcoes } from "@/lib/acesso";
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

/** "HH:MM" digitado -> minutos; vazio/inválido = null (filtro desligado). */
function acimaDeMin(v: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function JornadaPage() {
  useAuditView("jornada");
  const { isAdmin } = useAuth();
  const [fDia, setFDia] = usePersistentState("jornada.fDia", "__all");
  const [fVersao, setFVersao] = usePersistentState("jornada.fVersao", "__all");
  const [fTipo, setFTipo] = usePersistentState("jornada.fTipo", "__all");
  const [fLinha, setFLinha] = usePersistentState<string[]>("jornada.fLinha", []);
  const [fUnidade, setFUnidade] = usePersistentState("jornada.fUnidade", "__all");
  const [fGrupoOrdem, setFGrupoOrdem] = usePersistentState("jornada.fGrupoOrdem", "__all");
  // "Jornada acima de" (HH:MM digitado) — vazio = sem esse filtro.
  const [fAcimaDe, setFAcimaDe] = usePersistentState("jornada.fAcimaDe", "");
  const [modal, setModal] = useState<null | "7" | "9" | "he" | "sem_param">(null);
  const [pageSize, setPageSize] = usePersistentState("jornada.pageSize", 50);
  const [page, setPage] = useState(0);
  const [somenteAtivos, setSomenteAtivos] = usePersistentState("jornada.somenteAtivos", false);
  type Snap = { dia: string; versao: string; tipo: string; linha: string[]; unidade: string; grupoOrdem: string; acimaDe?: string };
  // Aplica filtros automaticamente ao abrir (usa cache se houver, sem recarregar)
  const [applied, setApplied] = useState<Snap | null>({ dia: "__all", versao: "__all", tipo: "__all", linha: [], unidade: "__all", grupoOrdem: "__all" });

  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const empresaEstacaoQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });
  const viagensRaw = viagensQ.data ?? [];
  const linhas = linhasQ.data ?? [];
  const empresaEstacao = empresaEstacaoQ.data ?? [];
  // Opções de filtro sem valores de outro Grupo/Empresa (acesso restrito).
  const acesso = useAcessoDados();
  const cad = useMemo(() => cadastroParaOpcoes(acesso, linhas, empresaEstacao, [] as { linha: string }[]), [acesso, linhas, empresaEstacao]);
  const ativos = ativosQ.data ?? [];
  const viagens = useMemo(
    () => (somenteAtivos ? filterViagensAtivas(viagensRaw, ativos) : viagensRaw),
    [viagensRaw, ativos, somenteAtivos],
  );

  const linhaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l])), [linhas]);
  const empresaOverrideMap = useMemo(() => buildEmpresaOverrideMap(empresaEstacao), [empresaEstacao]);

  const opts = useMemo(() => ({
    dia: Array.from(new Set(viagens.map((v) => v.tipo_operacao).filter(Boolean) as string[])).sort(),
    versao: Array.from(new Set(viagens.map((v) => v.versao_programacao).filter(Boolean) as string[])).sort(),
    linha: Array.from(new Set(viagens.map((v) => v.linha).filter(Boolean))).sort(),
    unidade: Array.from(new Set(cad.linhasDonas.map((l) => l.unidade).filter(Boolean) as string[])).sort(),
    grupoOrdem: Array.from(new Set([
      ...cad.linhasDonas.map((l) => l.ordem).filter(Boolean) as string[],
      ...cad.empresaEstacao.map((e) => e.grupo).filter(Boolean) as string[],
    ])).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
  }), [viagens, linhas, empresaEstacao, cad]);

  // Viagens dos serviços do recorte: só dia tipo/versão. Linha, Unidade e
  // Grupo filtram a JORNADA (linha dela / unidade e grupo do serviço), não
  // as viagens — filtrar viagem por linha cortava serviços que passam por
  // mais de uma linha (TU perdia um turno e sumia do total, jornada/hora
  // extra/custo saíam menores).
  const filtered = useMemo(() => {
    if (!applied) return [];
    return viagens.filter((v) => {
      if (applied.dia !== "__all" && v.tipo_operacao !== applied.dia) return false;
      if (applied.versao !== "__all" && v.versao_programacao !== applied.versao) return false;
      return true;
    });
  }, [viagens, applied]);
  const empresaPorServico = useMemo(() => buildEmpresaPorServico(filtered, linhaMap, empresaOverrideMap), [filtered, linhaMap, empresaOverrideMap]);
  const unidadePorServico = useMemo(() => buildUnidadePorServico(filtered, linhaMap, empresaOverrideMap), [filtered, linhaMap, empresaOverrideMap]);
  const grupoPorServico = useMemo(() => buildGrupoPorServico(filtered, linhaMap, empresaOverrideMap), [filtered, linhaMap, empresaOverrideMap]);
  const passaFiltroJornada = useCallback((j: JornadaServico) => {
    if (!applied) return false;
    if (applied.linha.length && !applied.linha.includes(j.linha)) return false;
    if (applied.unidade !== "__all" && (unidadePorServico.get(j.vehicleKey) ?? linhaMap.get(j.linha)?.unidade) !== applied.unidade) return false;
    if (applied.grupoOrdem !== "__all" && (grupoPorServico.get(j.vehicleKey) ?? linhaMap.get(j.linha)?.ordem) !== applied.grupoOrdem) return false;
    return true;
  }, [applied, unidadePorServico, grupoPorServico, linhaMap]);

  const { params: custoParams } = useParametrosCusto();
  const jornadas = useMemo(() => {
    if (!applied) return [];
    let all = buildJornadas(filtered, linhasParaJornada(linhas, custoParams?.somarAntecPrest)).filter(passaFiltroJornada);
    if (applied.tipo === "TU") all = all.filter((j) => j.tipoServico === "TU");
    else if (applied.tipo === "DIR") all = all.filter((j) => j.tipoServico === "DIR");
    // "Jornada acima de": só jornadas MAIORES que a hora digitada (TU
    // incompleto fica fora, mesma regra dos totais).
    const acima = acimaDeMin(applied.acimaDe);
    if (acima != null) all = all.filter((j) => !j.incompleto && j.minutosTotal > acima);
    return all;
  }, [applied, filtered, linhas, passaFiltroJornada, custoParams?.somarAntecPrest]);

  const [ordenarPor, setOrdenarPor] = usePersistentState<"padrao" | "unidade">("jornada.ordenarPor", "padrao");

  // Resumo Gerencial por Empresa / Grupo / Unidade — precisa vir antes de
  // jornadasOrdenadas, que usa unidadePorServico pra ordenar.

  const jornadasOrdenadas = useMemo(() => {
    if (ordenarPor !== "unidade") return jornadas;
    return [...jornadas].sort((a, b) => {
      const ua = unidadePorServico.get(a.vehicleKey) ?? "";
      const ub = unidadePorServico.get(b.vehicleKey) ?? "";
      if (ua !== ub) return ua.localeCompare(ub, "pt-BR");
      return a.linha.localeCompare(b.linha, "pt-BR");
    });
  }, [jornadas, ordenarPor, unidadePorServico]);

  const totais = useMemo(() => jornadaTotais(jornadas), [jornadas]);
  // Resumo do filtro "Jornada acima de": quantas, soma das horas extras
  // (acima do limite legal 7h DIR / 8h24 TU) e o quanto passou da hora
  // digitada.
  const acimaMinAplicado = acimaDeMin(applied?.acimaDe);
  const resumoAcima = useMemo(() => {
    if (acimaMinAplicado == null) return null;
    let excedente = 0, horasExtras = 0, dir = 0, tu = 0;
    for (const j of jornadas) {
      excedente += j.minutosTotal - acimaMinAplicado;
      horasExtras += j.horasExtras;
      if (j.tipoServico === "TU") tu++; else dir++;
    }
    return { quantidade: jornadas.length, horasExtras, excedente, dir, tu };
  }, [jornadas, acimaMinAplicado]);

  const totalPaginas = Math.max(1, Math.ceil(jornadas.length / pageSize));
  const paginaAtual = Math.min(page, totalPaginas - 1);
  const jornadasPagina = useMemo(
    () => jornadas.slice(paginaAtual * pageSize, paginaAtual * pageSize + pageSize),
    [jornadas, paginaAtual, pageSize],
  );
  useEffect(() => setPage(0), [applied, pageSize]);

  const [mostrarCusto, setMostrarCusto] = usePersistentState("jornada.mostrarCusto", false);
  const comCustoTabela = mostrarCusto && !!custoParams && custoParams.salarioMotoristaMensal > 0;
  const colSpanTabela = comCustoTabela ? 8 : 7;

  function resumoPorChave(chaveFn: (j: JornadaServico) => string): ResumoJornadaRow[] {
    const m = new Map<string, { jornadas: number; dir: number; tu: number; frota: Set<string>; minutosTotal: number; horasExtras: number; excedente: number; custo: number }>();
    for (const j of jornadas) {
      // Mesma regra do cabeçalho (jornadaTotais): TU incompleto (só T1 ou só
      // T2) não entra em nenhum total — senão "Custo M.O." e os outros
      // totais desse resumo ficam maiores que o total mostrado no topo.
      if (j.incompleto) continue;
      const k = chaveFn(j);
      const cur = m.get(k) ?? { jornadas: 0, dir: 0, tu: 0, frota: new Set<string>(), minutosTotal: 0, horasExtras: 0, excedente: 0, custo: 0 };
      cur.jornadas++;
      if (j.tipoServico === "TU") cur.tu++; else cur.dir++;
      cur.frota.add(j.vehicleKey);
      cur.minutosTotal += j.minutosTotal;
      cur.horasExtras += j.horasExtras;
      // Quanto passou da hora digitada em "Jornada acima de" (só com filtro).
      if (acimaMinAplicado != null) cur.excedente += Math.max(0, j.minutosTotal - acimaMinAplicado);
      if (custoParams) cur.custo += custoServico(j, custoParams);
      m.set(k, cur);
    }
    return Array.from(m, ([chave, x]) => ({
      chave, jornadas: x.jornadas, dir: x.dir, tu: x.tu, frota: x.frota.size, minutosTotal: x.minutosTotal,
      horasExtras: x.horasExtras, excedente: x.excedente, custo: x.custo,
    })).sort((a, b) => a.chave.localeCompare(b.chave, "pt-BR", { numeric: true }));
  }

  const resumoEmpresa = useMemo(
    () => resumoPorChave((j) => empresaPorServico.get(j.vehicleKey) || linhaMap.get(j.linha)?.empresa || "Sem empresa"),
    [jornadas, empresaPorServico, linhaMap, custoParams, acimaMinAplicado],
  );
  const resumoUnidade = useMemo(
    () => resumoPorChave((j) => unidadePorServico.get(j.vehicleKey) || linhaMap.get(j.linha)?.unidade || "Sem unidade"),
    [jornadas, linhaMap, unidadePorServico, custoParams, acimaMinAplicado],
  );
  const resumoGrupo = useMemo(
    () => resumoPorChave((j) => grupoPorServico.get(j.vehicleKey) || linhaMap.get(j.linha)?.ordem || "Sem grupo"),
    [jornadas, grupoPorServico, linhaMap, custoParams, acimaMinAplicado],
  );
  const resumoLinha = useMemo(
    () => resumoPorChave((j) => j.linha || "Sem linha"),
    [jornadas, custoParams, acimaMinAplicado],
  );
  const resumoDiaTipo = useMemo(
    () => resumoPorChave((j) => j.vehicleKey.split("||")[1] || "Sem dia tipo"),
    [jornadas, custoParams, acimaMinAplicado],
  );
  // Ordem usada na tela, no Excel (uma aba cada) e no PDF.
  const resumosGerenciais = [
    { titulo: "Resumo por Empresa", aba: "Por Empresa", coluna: "Empresa", rows: resumoEmpresa },
    { titulo: "Resumo por Grupo", aba: "Por Grupo", coluna: "Grupo", rows: resumoGrupo },
    { titulo: "Resumo por Unidade", aba: "Por Unidade", coluna: "Unidade", rows: resumoUnidade },
    { titulo: "Resumo por Linha", aba: "Por Linha", coluna: "Linha", rows: resumoLinha },
    { titulo: "Resumo por Dia Tipo", aba: "Por Dia Tipo", coluna: "Dia Tipo", rows: resumoDiaTipo },
  ];
  const comCustoResumo = comCustoTabela;

  const listaModal = useMemo((): JornadaServico[] => {
    if (!modal) return [];
    // Mesma regra dos indicadores (jornadaTotais): TU incompleto não entra
    // nas listas de >9h / >10h / hora extra — senão a lista tinha mais itens
    // que o número do indicador que abriu ela.
    if (modal === "7") return jornadas.filter((j) => !j.incompleto && j.acimaDe7h && !j.acimaDe9h);
    if (modal === "9") return jornadas.filter((j) => !j.incompleto && j.acimaDe9h);
    if (modal === "sem_param") return jornadas.filter((j) => j.semCadastroLinha);
    return jornadas.filter((j) => !j.incompleto && j.horasExtras > 0);
  }, [jornadas, modal]);

  function exportModalXLSX() {
    const nome = modal === "9" ? "acima_10h_critico" : modal === "7" ? "acima_9h" : modal === "sem_param" ? "sem_parametro_antecipacao" : "horas_extras";
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

  function periodoTexto() {
    return [
      applied?.dia && applied.dia !== "__all" ? applied.dia : "Todos os dias",
      applied?.versao && applied.versao !== "__all" ? `Versão ${applied.versao}` : null,
      applied?.tipo && applied.tipo !== "__all" ? `Tipo ${applied.tipo}` : null,
      acimaMinAplicado != null ? `Jornada acima de ${fmtDur(acimaMinAplicado)}` : null,
      custoParams?.somarAntecPrest === false ? "Sem antecipação/prestação" : null,
    ].filter(Boolean).join(" · ");
  }
  // Colunas dos resumos — Excedente só com o filtro "acima de"; Custo só
  // com "Mostrar custo" ligado e salário configurado.
  function resumoHead(primeira: string): string[] {
    return [primeira, "Jornadas", "DIR", "TU", "Frota", "Jornada Total", "Horas Extras",
      ...(acimaMinAplicado != null ? [`Excedente > ${fmtDur(acimaMinAplicado)}`] : []),
      ...(comCustoResumo ? ["Custo M.O."] : [])];
  }
  function resumoLinhaValores(r: ResumoJornadaRow): string[] {
    return [r.chave, String(r.jornadas), String(r.dir), String(r.tu), String(r.frota), fmtDur(r.minutosTotal), fmtDur(r.horasExtras),
      ...(acimaMinAplicado != null ? [fmtDur(r.excedente)] : []),
      ...(comCustoResumo ? [fmtMoeda(r.custo)] : [])];
  }

  function exportXLSX() {
    const wb = XLSX.utils.book_new();
    const rows = jornadasOrdenadas.map((j) => ({
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
    // Aba "Resumo": filtros aplicados + totais (e o quadro do filtro
    // "Jornada acima de", quando ativo).
    const resumoAoa: (string | number)[][] = [
      ["JORNADA DE TRABALHO"],
      ["Filtros", periodoTexto()],
      ["Gerado em", new Date().toLocaleString("pt-BR")],
      [],
      ["Jornadas", totais.totalJornadas],
      ["Jornada total (h:mm)", fmtDur(totais.minutosTotal)],
      ["Horas extras (h:mm)", fmtDur(totais.horasExtrasTotal)],
      ["Acima de 9h", totais.acimaDe7h],
      ["Acima de 10h (crítico)", totais.acimaDe9h],
    ];
    if (resumoAcima && acimaMinAplicado != null) {
      resumoAoa.push([], [`Jornadas acima de ${fmtDur(acimaMinAplicado)}`],
        ["Quantidade", resumoAcima.quantidade], ["DIR", resumoAcima.dir], ["TU", resumoAcima.tu],
        ["Soma das horas extras (h:mm)", fmtDur(resumoAcima.horasExtras)],
        [`Excedente acima de ${fmtDur(acimaMinAplicado)} (h:mm)`, fmtDur(resumoAcima.excedente)]);
    }
    const wsResumo = XLSX.utils.aoa_to_sheet(resumoAoa);
    wsResumo["!cols"] = [{ wch: 34 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");
    for (const r of resumosGerenciais) {
      if (!r.rows.length) continue;
      const head = resumoHead(r.coluna);
      const aoa = [head, ...r.rows.map(resumoLinhaValores), resumoLinhaValores(totalResumo(r.rows, "TOTAL"))];
      const wsR = XLSX.utils.aoa_to_sheet(aoa);
      wsR["!cols"] = head.map((_, i) => ({ wch: i === 0 ? 24 : 14 }));
      XLSX.utils.book_append_sheet(wb, wsR, r.aba);
    }
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

    const periodo = periodoTexto();
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

    const bodyRows = jornadasOrdenadas.map((j) => [
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

    // Resumos depois da tabela principal: quadro do filtro "Jornada acima
    // de" (se ativo) + Empresa / Grupo / Unidade / Linha / Dia Tipo.
    let y = (doc2 as any).lastAutoTable.finalY + 6;
    const novaPaginaSePreciso = (alturaMin: number) => {
      if (y + alturaMin > pageH - 14) { doc2.addPage(); drawHeader(doc2); y = HEADER_H + 4; }
    };
    if (resumoAcima && acimaMinAplicado != null) {
      novaPaginaSePreciso(24);
      autoTable(doc2, {
        startY: y,
        head: [[`Jornadas acima de ${fmtDur(acimaMinAplicado)}`, ""]],
        body: [
          ["Quantidade", `${resumoAcima.quantidade} (DIR ${resumoAcima.dir} · TU ${resumoAcima.tu})`],
          ["Soma das horas extras", fmtDur(resumoAcima.horasExtras)],
          [`Excedente acima de ${fmtDur(acimaMinAplicado)}`, fmtDur(resumoAcima.excedente)],
        ],
        styles: { fontSize: 7.5, cellPadding: 1.4, lineColor: [180, 180, 180], lineWidth: 0.18 },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
        columnStyles: { 0: { fontStyle: "bold" } },
        margin: { left: 10, right: 10, top: HEADER_H + 3, bottom: 12 },
        theme: "grid",
        tableWidth: "wrap",
        didDrawPage: () => drawHeader(doc2),
      });
      y = (doc2 as any).lastAutoTable.finalY + 6;
    }
    for (const r of resumosGerenciais) {
      if (!r.rows.length) continue;
      novaPaginaSePreciso(20);
      doc2.setFont("helvetica", "bold"); doc2.setFontSize(9); doc2.setTextColor(37, 99, 235);
      doc2.text(r.titulo, 10, y);
      doc2.setTextColor(20);
      autoTable(doc2, {
        startY: y + 2,
        head: [resumoHead(r.coluna)],
        body: r.rows.map(resumoLinhaValores),
        foot: [resumoLinhaValores(totalResumo(r.rows, "TOTAL"))],
        styles: { fontSize: 7, cellPadding: 1.2, halign: "right", lineColor: [180, 180, 180], lineWidth: 0.18 },
        columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
        headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold", halign: "center" },
        footStyles: { fillColor: [219, 234, 254], textColor: 20, fontStyle: "bold", halign: "right" },
        margin: { left: 10, right: 10, top: HEADER_H + 3, bottom: 12 },
        theme: "grid",
        tableWidth: "wrap",
        showFoot: "lastPage",
        rowPageBreak: "avoid",
        didDrawPage: () => drawHeader(doc2),
      });
      y = (doc2 as any).lastAutoTable.finalY + 6;
    }

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
            Cálculo por serviço/motorista.
            Limite jornada: DIR <strong>{fmtDur(LIMITE_DIR_MIN)}</strong> · TU <strong>{fmtDur(LIMITE_TU_MIN)}</strong>.
          </p>
          {/* Deixa claro qual cálculo está na tela — o liga/desliga fica em
              Parâmetros de Custo e muda jornada, hora extra e custo. */}
          <p className={`mt-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${custoParams?.somarAntecPrest === false ? "border-warning/40 bg-warning/10 text-warning" : "border-border bg-muted/40 text-muted-foreground"}`}>
            {custoParams?.somarAntecPrest === false
              ? "Antecipação e prestação de contas NÃO somadas: jornada = 1ª partida → última chegada."
              : "Antecipação e prestação de contas somadas na jornada (cadastro por linha/turno)."}
            {isAdmin && <Link to="/parametros-custo" className="underline underline-offset-2 hover:opacity-80">Alterar</Link>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={ordenarPor} onValueChange={(v) => setOrdenarPor(v as any)}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="padrao">Ordem padrão</SelectItem>
              <SelectItem value="unidade">Ordenar por Unidade</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none px-2">
            <Switch checked={mostrarCusto} onCheckedChange={setMostrarCusto} className="scale-90" />
            Mostrar custo de mão de obra
          </label>
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
            {jornadasOrdenadas.map((j) => (
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
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Unidade</label>
            <Select value={fUnidade} onValueChange={setFUnidade}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todos</SelectItem>
                {opts.unidade.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Grupo</label>
            <Select value={fGrupoOrdem} onValueChange={setFGrupoOrdem}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todos</SelectItem>
                {opts.grupoOrdem.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Jornada acima de</label>
            <div className="flex items-center gap-1">
              <Input
                type="time"
                value={fAcimaDe}
                onChange={(e) => setFAcimaDe(e.target.value)}
                className="h-8 w-[110px] text-xs"
                title="Mostra só jornadas maiores que essa duração (horas:minutos). Vazio = todas."
              />
              {fAcimaDe && (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setFAcimaDe("")} title="Limpar">×</Button>
              )}
            </div>
          </div>
          <label className="flex items-end gap-2 text-xs cursor-pointer select-none pb-1">
            <Checkbox checked={somenteAtivos} onCheckedChange={(v) => setSomenteAtivos(!!v)} />
            Somente projetos ativos
          </label>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setApplied({ dia: fDia, versao: fVersao, tipo: fTipo, linha: fLinha, unidade: fUnidade, grupoOrdem: fGrupoOrdem, acimaDe: fAcimaDe })} disabled={viagensQ.isLoading || linhasQ.isLoading}>
              Consultar
            </Button>
            {applied && <Button variant="outline" size="sm" onClick={() => setApplied(null)}>Limpar</Button>}
          </div>
        </CardContent>
      </Card>

      {resumoAcima && acimaMinAplicado != null && (
        <Card className="shadow-[var(--shadow-card)] border-warning/40">
          <CardContent className="p-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="font-semibold">Jornadas acima de {fmtDur(acimaMinAplicado)}</span>
            <span>Quantidade: <strong className="tabular-nums">{resumoAcima.quantidade.toLocaleString("pt-BR")}</strong>
              <span className="text-xs text-muted-foreground"> (DIR {resumoAcima.dir} · TU {resumoAcima.tu})</span></span>
            <span>Soma das horas extras: <strong className="tabular-nums">{fmtDur(resumoAcima.horasExtras)}</strong>
              <span className="text-xs text-muted-foreground"> (acima de {fmtDur(LIMITE_DIR_MIN)} DIR / {fmtDur(LIMITE_TU_MIN)} TU)</span></span>
            <span>Excedente acima de {fmtDur(acimaMinAplicado)}: <strong className="tabular-nums">{fmtDur(resumoAcima.excedente)}</strong></span>
          </CardContent>
        </Card>
      )}

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
          {totais.semCadastroLinha > 0 && (
            <button className="underline decoration-dotted hover:decoration-solid" onClick={() => setModal("sem_param")}>
              <strong>{totais.semCadastroLinha}</strong> jornada(s) estão sem parâmetros de antecipação/prestação da linha — clique para ver quais.
            </button>
          )}
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
                  {comCustoTabela && <TableHead className="text-right">Custo M.O.</TableHead>}
                  <TableHead className="text-center">Alerta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!applied && <TableRow><TableCell colSpan={colSpanTabela} className="text-center py-6 text-muted-foreground">Aplique os filtros e clique em <strong>Consultar</strong>.</TableCell></TableRow>}
                {applied && loading && <TableRow><TableCell colSpan={colSpanTabela} className="text-center py-6 text-muted-foreground">Carregando...</TableCell></TableRow>}
                {!loading && jornadasPagina.map((j) => (
                  <TableRow key={`${j.vehicleKey}||${j.bucket}`}>
                    <TableCell className="font-medium">{j.linha}</TableCell>
                    <TableCell><Badge variant="outline">{j.tipoServico}</Badge></TableCell>
                    <TableCell>{j.servico}</TableCell>
                    <TableCell className="text-xs">{j.turnos.map((t) => `T${t.turno} ${t.primeiraPartida}→${t.ultimaChegada}`).join(" · ")}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{fmtDur(j.minutosTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{j.horasExtras > 0 ? fmtDur(j.horasExtras) : "—"}</TableCell>
                    {comCustoTabela && custoParams && (
                      <TableCell className="text-right tabular-nums">{fmtMoeda(custoServico(j, custoParams))}</TableCell>
                    )}
                    <TableCell className="text-center">
                      {j.acimaDe9h ? <Badge variant="destructive">&gt;10h</Badge>
                        : j.acimaDe7h ? <Badge className="bg-warning text-warning-foreground">&gt;9h</Badge>
                        : <span className="text-muted-foreground text-xs">OK</span>}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && !jornadas.length && <TableRow><TableCell colSpan={colSpanTabela} className="text-center py-6 text-muted-foreground">Sem jornadas para os filtros atuais.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          {jornadas.length > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap p-3 border-t">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Exibir</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span>por página · {jornadas.length} no total</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={paginaAtual === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
                <span className="text-xs text-muted-foreground">Página {paginaAtual + 1} de {totalPaginas}</span>
                <Button variant="outline" size="sm" disabled={paginaAtual >= totalPaginas - 1} onClick={() => setPage((p) => Math.min(totalPaginas - 1, p + 1))}>Próxima</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {resumosGerenciais.map((r) => (
        <ResumoJornadaTable key={r.aba} titulo={r.titulo} rows={r.rows} mostrarCusto={comCustoTabela} acimaMin={acimaMinAplicado} />
      ))}
      </div>

      <Dialog open={!!modal} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {modal === "9" && `Serviços acima de 10h — crítico (${listaModal.length})`}
              {modal === "7" && `Serviços entre 9h e 10h (${listaModal.length})`}
              {modal === "he" && `Serviços com horas extras (${listaModal.length})`}
              {modal === "sem_param" && `Jornadas sem parâmetro de antecipação/prestação (${listaModal.length})`}
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

type ResumoJornadaRow = { chave: string; jornadas: number; dir: number; tu: number; frota: number; minutosTotal: number; horasExtras: number; excedente: number; custo: number };

/** Linha de TOTAL de um resumo. Frota soma as linhas do resumo (cada
 *  veículo aparece numa linha só quando a chave é por veículo; por Linha/Dia
 *  Tipo um veículo que roda em mais de uma linha conta em cada uma). */
function totalResumo(rows: ResumoJornadaRow[], chave: string): ResumoJornadaRow {
  return rows.reduce((s, r) => ({
    chave, jornadas: s.jornadas + r.jornadas, dir: s.dir + r.dir, tu: s.tu + r.tu, frota: s.frota + r.frota,
    minutosTotal: s.minutosTotal + r.minutosTotal, horasExtras: s.horasExtras + r.horasExtras,
    excedente: s.excedente + r.excedente, custo: s.custo + r.custo,
  }), { chave, jornadas: 0, dir: 0, tu: 0, frota: 0, minutosTotal: 0, horasExtras: 0, excedente: 0, custo: 0 });
}
function ResumoJornadaTable({ titulo, rows, mostrarCusto, acimaMin }: { titulo: string; rows: ResumoJornadaRow[]; mostrarCusto?: boolean; acimaMin?: number | null }) {
  if (rows.length === 0) return null;
  const comCusto = !!mostrarCusto && rows.some((r) => r.custo > 0);
  const comExcedente = acimaMin != null;
  const tot = totalResumo(rows, "TOTAL");
  const linha = (r: ResumoJornadaRow, total = false) => (
    <TableRow key={total ? "__total" : r.chave} className={total ? "bg-muted/50 font-bold h-9" : "h-8"}>
      <TableCell className={`px-2 py-1 ${total ? "" : "font-medium"}`}>{r.chave}</TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{r.jornadas}</TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{r.dir}</TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{r.tu}</TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{r.frota}</TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtDur(r.minutosTotal)}</TableCell>
      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtDur(r.horasExtras)}</TableCell>
      {comExcedente && <TableCell className="px-2 py-1 text-right tabular-nums">{fmtDur(r.excedente)}</TableCell>}
      {comCusto && <TableCell className="px-2 py-1 text-right tabular-nums">{fmtMoeda(r.custo)}</TableCell>}
    </TableRow>
  );
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{titulo}</CardTitle></CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-auto max-h-[420px]">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="px-2 py-1"></TableHead>
                <TableHead className="px-2 py-1 text-right">Jornadas</TableHead>
                <TableHead className="px-2 py-1 text-right">DIR</TableHead>
                <TableHead className="px-2 py-1 text-right">TU</TableHead>
                <TableHead className="px-2 py-1 text-right">Frota</TableHead>
                <TableHead className="px-2 py-1 text-right">Jornada Total</TableHead>
                <TableHead className="px-2 py-1 text-right">Horas Extras</TableHead>
                {comExcedente && <TableHead className="px-2 py-1 text-right">Excedente &gt; {fmtDur(acimaMin!)}</TableHead>}
                {comCusto && <TableHead className="px-2 py-1 text-right">Custo M.O.</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => linha(r))}
              {linha(tot, true)}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
