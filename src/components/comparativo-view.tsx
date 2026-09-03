// Relatório Comparativo — compara duas seleções (ATUAL vs PROPOSTA) usando
// exatamente a mesma base e pipeline do "Resumo por Linha":
//   buildServiceUnits -> aggregateByLinha -> AggRow
// Reaproveita todos os filtros já existentes e todos os campos (dir1, dir2,
// aprov, tu, serviços, frota, partidas, KM). Novos campos adicionados no
// tipo AggRow futuramente aparecem automaticamente via METRICS.

import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { fetchLinhas, fetchKm, fetchMulti, type Linha, type ParametroMulti } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import {
  buildServiceUnits, aggregateByLinha,
  type ViagemLite, type AggRow, type CriterioLinha,
} from "@/lib/resumo";
import { buildKmMaps, viagemKm, viagemKmResult, fmtKm, fmtInt } from "@/lib/km";
import { fetchProjetosAtivos, filterViagensAtivas } from "@/lib/projeto-ativo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, FileText, GitCompare, ArrowUpDown, Printer } from "lucide-react";
import { MultiSelect } from "@/components/multi-select";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PdfPreviewDialog, type PdfOrientation } from "@/components/pdf-preview-dialog";
import { logAudit } from "@/lib/audit";
import { buildJornadas, fmtDur } from "@/lib/jornada";
import { usePersistentState } from "@/hooks/use-persistent-state";

function parseHHMM(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/** Métricas disponíveis no AggRow — refletem 1:1 o Resumo por Linha. */
const METRICS: { key: keyof AggRow; label: string; fmt: (n: number) => string }[] = [
  { key: "dir1", label: "Dir 1º T.", fmt: fmtInt },
  { key: "dir2", label: "Dir 2º T.", fmt: fmtInt },
  { key: "aprov", label: "Aproveit.", fmt: fmtInt },
  { key: "tu", label: "TU", fmt: fmtInt },
  { key: "totalServico", label: "Serviços", fmt: fmtInt },
  { key: "frota", label: "Frota", fmt: fmtInt },
  { key: "partidas", label: "Partidas", fmt: fmtInt },
  { key: "km", label: "KM Total", fmt: (n) => fmtKm(n) },
  { key: "heMin", label: "HE Programada", fmt: (n) => fmtDur(Math.round(n)) },
];

type Filters = {
  dia: string;
  linha: string[];
  grupo: string;
  categoria: string;
  empresa: string;
  unidade: string;
  faixa: string;
  versao: string;
  origem: string;
  destino: string;
};

const EMPTY_FILTERS: Filters = {
  dia: "__all", linha: [], grupo: "__all", categoria: "__all", empresa: "__all", unidade: "__all",
  faixa: "__all", versao: "__all", origem: "__all", destino: "__all",
};

function passesExceptLinha(
  v: ViagemLite,
  f: Filters,
  linhaMap: Map<string, Linha>,
  grupoMap: Map<string, string>,
): boolean {
  if (f.dia !== "__all" && v.tipo_operacao !== f.dia) return false;
  if (f.versao !== "__all" && v.versao_programacao !== f.versao) return false;
  if (f.origem !== "__all" && v.origem !== f.origem) return false;
  if (f.destino !== "__all" && v.destino !== f.destino) return false;
  const l = linhaMap.get(v.linha);
  if (f.empresa !== "__all" && l?.empresa !== f.empresa) return false;
  if (f.unidade !== "__all" && l?.unidade !== f.unidade) return false;
  if (f.categoria !== "__all" && l?.categoria !== f.categoria) return false;
  if (f.grupo !== "__all") {
    const g = grupoMap.get(`${v.linha}|${v.tipo_operacao ?? ""}`.toLowerCase());
    if (g !== f.grupo) return false;
  }
  if (f.faixa !== "__all") {
    const m = parseHHMM(v.partida);
    if (m == null) return false;
    if (String(Math.floor(m / 60)).padStart(2, "0") !== f.faixa) return false;
  }
  return true;
}

function applyFilters(
  viagens: ViagemLite[],
  f: Filters,
  linhaMap: Map<string, Linha>,
  grupoMap: Map<string, string>,
): ViagemLite[] {
  const linhaSet = new Set(f.linha);
  return viagens.filter((v) => {
    if (linhaSet.size > 0 && !linhaSet.has(v.linha)) return false;
    return passesExceptLinha(v, f, linhaMap, grupoMap);
  });
}

// Universo de viagens SEM aplicar o filtro de linha — usado para determinar
// a linha de origem do veículo (regra de frota). Ver aggregateByLinha.
function applyFiltersSemLinha(
  viagens: ViagemLite[],
  f: Filters,
  linhaMap: Map<string, Linha>,
  grupoMap: Map<string, string>,
): ViagemLite[] {
  return viagens.filter((v) => passesExceptLinha(v, f, linhaMap, grupoMap));
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex flex-col gap-1 min-w-[130px]">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Todos</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function FilterBlock({
  title, tone, filters, setFilters, opts,
}: {
  title: string;
  tone: "atual" | "proposta";
  filters: Filters;
  setFilters: (f: Filters) => void;
  opts: ReturnType<typeof buildOpts>;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
  const toneCls = tone === "atual"
    ? "border-l-4 border-l-blue-500"
    : "border-l-4 border-l-emerald-500";
  return (
    <Card className={`shadow-[var(--shadow-card)] ${toneCls}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider flex items-center justify-between">
          <span>{title}</span>
          {filters.versao !== "__all" && (
            <Badge variant="secondary" className="text-[10px]">{filters.versao}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex flex-wrap gap-2">
        <FilterSelect label="Projeto / Versão" value={filters.versao} onChange={(v) => set("versao", v)} options={opts.versao} />
        <FilterSelect label="Dia tipo" value={filters.dia} onChange={(v) => set("dia", v)} options={opts.dia} />
        <MultiSelect label="Linha" values={filters.linha} onChange={(v) => set("linha", v)} options={opts.linha} placeholder="Todas" />
        <FilterSelect label="Grupo de Linha" value={filters.grupo} onChange={(v) => set("grupo", v)} options={opts.grupo} />
        <FilterSelect label="Tipo (Categoria)" value={filters.categoria} onChange={(v) => set("categoria", v)} options={opts.categoria} />
        <FilterSelect label="Empresa" value={filters.empresa} onChange={(v) => set("empresa", v)} options={opts.empresa} />
        <FilterSelect label="Unidade" value={filters.unidade} onChange={(v) => set("unidade", v)} options={opts.unidade} />
        <FilterSelect label="Origem" value={filters.origem} onChange={(v) => set("origem", v)} options={opts.origem} />
        <FilterSelect label="Destino" value={filters.destino} onChange={(v) => set("destino", v)} options={opts.destino} />
        <FilterSelect label="Faixa horária" value={filters.faixa} onChange={(v) => set("faixa", v)} options={opts.faixa} />
      </CardContent>
    </Card>
  );
}

function buildOpts(viagens: ViagemLite[], linhas: Linha[], multi: ParametroMulti[]) {
  const set = (fn: (v: ViagemLite) => string | null | undefined) =>
    Array.from(new Set(viagens.map(fn).filter(Boolean) as string[])).sort();
  return {
    dia: set((v) => v.tipo_operacao),
    linha: set((v) => v.linha),
    versao: set((v) => v.versao_programacao),
    origem: set((v) => v.origem),
    destino: set((v) => v.destino),
    faixa: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
    empresa: Array.from(new Set(linhas.map((l) => l.empresa).filter(Boolean) as string[])).sort(),
    unidade: Array.from(new Set(linhas.map((l) => l.unidade).filter(Boolean) as string[])).sort(),
    categoria: Array.from(new Set(linhas.map((l) => l.categoria).filter(Boolean) as string[])).sort(),
    grupo: Array.from(new Set(multi.map((m) => m.grupo_du).filter(Boolean))).sort(),
  };
}

function diffPct(a: number, b: number): number | null {
  if (a === 0) return b === 0 ? 0 : null;
  return ((b - a) / a) * 100;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const s = n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${n > 0 ? "+" : ""}${s}%`;
}

function fmtDelta(n: number, fmt: (n: number) => string): string {
  if (n === 0) return fmt(0);
  return `${n > 0 ? "+" : ""}${fmt(n)}`;
}

/**
 * Hora extra PROGRAMADA por linha: soma dos minutos excedentes ao limite de
 * jornada (DIR 7h / TU 8h24) de cada serviço, alocada na linha do serviço.
 */
function withHE(rows: AggRow[], viagens: ViagemLite[], linhas: Linha[]): AggRow[] {
  const he = new Map<string, number>();
  for (const j of buildJornadas(viagens, linhas)) {
    if (j.incompleto || j.horasExtras <= 0) continue;
    he.set(j.linha, (he.get(j.linha) ?? 0) + j.horasExtras);
  }
  return rows.map((r) => ({ ...r, heMin: he.get(r.groupKey) ?? 0 }));
}

export function ComparativoView() {
  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const kmQ = useQuery({ queryKey: ["km"], queryFn: fetchKm });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });

  const viagensRaw = viagensQ.data ?? [];
  const ativos = ativosQ.data ?? [];
  const [somenteAtivos, setSomenteAtivos] = usePersistentState("comparativo.somenteAtivos", true);
  const viagensAtivas = useMemo(
    () => filterViagensAtivas(viagensRaw, ativos),
    [viagensRaw, ativos],
  );
  // O filtro de "somente projetos ativos" NÃO pode ser aplicado ao lado que
  // escolhe uma versão específica: como só existe uma versão ativa por
  // (linha, dia-tipo), isso zerava/deformava o lado comparado. Cada lado usa
  // a base completa quando uma versão é escolhida explicitamente.
  const baseFor = useMemo(
    () => (f: Filters) =>
      somenteAtivos && f.versao === "__all" ? viagensAtivas : viagensRaw,
    [somenteAtivos, viagensAtivas, viagensRaw],
  );
  const viagens = viagensRaw;

  const linhas = linhasQ.data ?? [];
  const km = kmQ.data ?? [];
  const multi = multiQ.data ?? [];

  const linhaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l])), [linhas]);
  const ordemMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l.ordem])), [linhas]);
  const kmMaps = useMemo(() => buildKmMaps(km), [km]);
  const grupoMap = useMemo(() => {
    const m = new Map<string, string>();
    multi.forEach((mu) => m.set(`${mu.linha}|${mu.tipo_dia}`.toLowerCase(), mu.grupo_du));
    return m;
  }, [multi]);

  const opts = useMemo(() => buildOpts(viagens, linhas, multi), [viagens, linhas, multi]);
  const kmFn = useMemo(() => (v: ViagemLite) => viagemKm(v, kmMaps), [kmMaps]);

  const [atualFilters, setAtualFilters] = useState<Filters>(EMPTY_FILTERS);
  const [propostaFilters, setPropostaFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<{ a: Filters; p: Filters } | null>(null);
  // FLAG: regra de contagem de serviço/frota por linha
  const [criterio, setCriterio] = usePersistentState<CriterioLinha>("comparativo.criterio", "predominancia");

  // Métricas visíveis (persistida).
  const [visibleMetricsArr, setVisibleMetricsArr] = usePersistentState<string[]>(
    "comparativo.visibleMetrics",
    METRICS.map((m) => m.key as string),
  );
  const visibleMetrics = useMemo(() => new Set(visibleMetricsArr), [visibleMetricsArr]);
  const [showPct, setShowPct] = usePersistentState("comparativo.showPct", true);
  const [onlyDiff, setOnlyDiff] = usePersistentState("comparativo.onlyDiff", false);

  const atualRows = useMemo(() => {
    if (!applied) return [] as AggRow[];
    const base = baseFor(applied.a);
    const f = applyFilters(base, applied.a, linhaMap, grupoMap);
    const fOrigem = applyFiltersSemLinha(base, applied.a, linhaMap, grupoMap);
    return withHE(aggregateByLinha(buildServiceUnits(f, kmFn), f, ordemMap, fOrigem, criterio), f, linhas);
  }, [baseFor, applied, linhaMap, grupoMap, kmFn, ordemMap, criterio, linhas]);

  const propostaRows = useMemo(() => {
    if (!applied) return [] as AggRow[];
    const base = baseFor(applied.p);
    const f = applyFilters(base, applied.p, linhaMap, grupoMap);
    const fOrigem = applyFiltersSemLinha(base, applied.p, linhaMap, grupoMap);
    return withHE(aggregateByLinha(buildServiceUnits(f, kmFn), f, ordemMap, fOrigem, criterio), f, linhas);
  }, [baseFor, applied, linhaMap, grupoMap, kmFn, ordemMap, criterio, linhas]);


  const basesAplicadas = useMemo(() => {
    if (!applied) return { atual: [] as ViagemLite[], proposta: [] as ViagemLite[] };
    return {
      atual: applyFilters(baseFor(applied.a), applied.a, linhaMap, grupoMap),
      proposta: applyFilters(baseFor(applied.p), applied.p, linhaMap, grupoMap),
    };
  }, [baseFor, applied, linhaMap, grupoMap]);


  const totalFrotaUnica = useMemo(() => ({
    a: new Set(Array.from(buildServiceUnits(basesAplicadas.atual, kmFn).values()).map((u) => u.vehicleKey)).size,
    p: new Set(Array.from(buildServiceUnits(basesAplicadas.proposta, kmFn).values()).map((u) => u.vehicleKey)).size,
  }), [basesAplicadas, kmFn]);

  const kmSemCadastro = useMemo(() => ({
    atual: basesAplicadas.atual.filter((v) => viagemKmResult(v, kmMaps).fonte === "sem_cadastro").length,
    proposta: basesAplicadas.proposta.filter((v) => viagemKmResult(v, kmMaps).fonte === "sem_cadastro").length,
  }), [basesAplicadas, kmMaps]);

  const [ordenarPor, setOrdenarPor] = usePersistentState<"padrao" | "unidade">("comparativo.ordenarPor", "padrao");

  const merged = useMemo(() => {
    const map = new Map<string, { linha: string; order: number; a: AggRow | null; p: AggRow | null }>();
    for (const r of atualRows) {
      map.set(r.groupKey, { linha: r.groupLabel, order: r.groupOrder, a: r, p: null });
    }
    for (const r of propostaRows) {
      const cur = map.get(r.groupKey);
      if (cur) cur.p = r;
      else map.set(r.groupKey, { linha: r.groupLabel, order: r.groupOrder, a: null, p: r });
    }
    let arr = Array.from(map.values()).sort((a, b) => {
      if (ordenarPor === "unidade") {
        const ua = linhaMap.get(a.linha)?.unidade ?? "";
        const ub = linhaMap.get(b.linha)?.unidade ?? "";
        if (ua !== ub) return ua.localeCompare(ub, "pt-BR");
      }
      if (a.order !== b.order) return a.order - b.order;
      return a.linha.localeCompare(b.linha);
    });
    if (onlyDiff) {
      arr = arr.filter(({ a, p }) =>
        METRICS.some((m) => (a?.[m.key] as number ?? 0) !== (p?.[m.key] as number ?? 0)),
      );
    }
    return arr;
  }, [atualRows, propostaRows, onlyDiff, ordenarPor, linhaMap]);

  const totals = useMemo(() => {
    const base = { a: {} as Record<string, number>, p: {} as Record<string, number> };
    for (const m of METRICS) { base.a[m.key as string] = 0; base.p[m.key as string] = 0; }
    for (const r of atualRows) {
      for (const m of METRICS) base.a[m.key as string] += (r[m.key] as number) ?? 0;
    }
    for (const r of propostaRows) {
      for (const m of METRICS) base.p[m.key as string] += (r[m.key] as number) ?? 0;
    }
    base.a.frota = totalFrotaUnica.a;
    base.p.frota = totalFrotaUnica.p;
    return base;
  }, [atualRows, propostaRows, totalFrotaUnica]);

  const shownMetrics = METRICS.filter((m) => visibleMetrics.has(m.key as string));
  const colsPerMetric = showPct ? 4 : 3;
  const totalCols = 1 + shownMetrics.length * colsPerMetric;

  function toggleMetric(k: string) {
    const next = new Set(visibleMetrics);
    if (next.has(k)) next.delete(k); else next.add(k);
    setVisibleMetricsArr(Array.from(next));
  }

  const loading = viagensQ.isLoading || linhasQ.isLoading || kmQ.isLoading || multiQ.isLoading;

  function buildExportRows() {
    const header1: string[] = ["Linha"];
    const header2: string[] = [""];
    for (const m of shownMetrics) {
      header1.push(m.label, "", "", ...(showPct ? [""] : []));
      header2.push("Atual", "Proposta", "Δ", ...(showPct ? ["Δ%"] : []));
    }
    const body = merged.map(({ linha, a, p }) => {
      const row: (string | number)[] = [linha];
      for (const m of shownMetrics) {
        const av = (a?.[m.key] as number) ?? 0;
        const pv = (p?.[m.key] as number) ?? 0;
        const d = pv - av;
        row.push(av, pv, d);
        if (showPct) row.push(diffPct(av, pv) ?? 0);
      }
      return row;
    });
    const tot: (string | number)[] = ["TOTAL"];
    for (const m of shownMetrics) {
      const av = totals.a[m.key as string];
      const pv = totals.p[m.key as string];
      tot.push(av, pv, pv - av);
      if (showPct) tot.push(diffPct(av, pv) ?? 0);
    }
    return { header1, header2, body, tot };
  }

  // Compartilhada entre exportXLSX/exportPDF e a view de impressão.
  function cellFor(v: any, i: number) {
    if (i === 0) return String(v);
    const idx = (i - 1) % colsPerMetric;
    const metricIdx = Math.floor((i - 1) / colsPerMetric);
    const m = shownMetrics[metricIdx];
    if (showPct && idx === 3) return fmtPct(typeof v === "number" ? v : 0);
    if (idx === 2) return fmtDelta(Number(v), m.fmt);
    return m.fmt(Number(v));
  }

  function exportXLSX() {
    const { header1, header2, body, tot } = buildExportRows();
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [
      ["RELATÓRIO COMPARATIVO — ATUAL vs PROPOSTA"],
      [`Gerado em ${new Date().toLocaleString("pt-BR")} — ${merged.length} linha(s)`],
      [],
      header1,
      header2,
      ...body,
      tot,
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: header2.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: header2.length - 1 } },
    ];
    let c = 1;
    for (let i = 0; i < shownMetrics.length; i++) {
      ws["!merges"].push({ s: { r: 3, c }, e: { r: 3, c: c + colsPerMetric - 1 } });
      c += colsPerMetric;
    }
    ws["!cols"] = Array.from({ length: header2.length }, (_, i) => ({ wch: i === 0 ? 24 : 12 }));
    XLSX.utils.book_append_sheet(wb, ws, "Comparativo");
    XLSX.writeFile(wb, `relatorio_comparativo_${new Date().toISOString().slice(0, 10)}.xlsx`);
    void logAudit({ action: "export", entity: "relatorio_comparativo", details: { format: "xlsx", rows: merged.length } });
  }

  function buildPDF(orientation: PdfOrientation) {
      const { header1, header2, body, tot } = buildExportRows();
      const probe = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const pageW = probe.internal.pageSize.getWidth();
      const pageH = probe.internal.pageSize.getHeight();
      const HEADER_H = 16;
      const usableW = pageW - 16;
      const usableH = pageH - (HEADER_H + 3) - 12;

      const periodoTxt = (f: Filters) => [
        f.dia !== "__all" ? f.dia : "Todos os dias",
        f.versao !== "__all" ? `Versão ${f.versao}` : null,
      ].filter(Boolean).join(" · ");
      const subtitleTxt = applied
        ? `Atual: ${periodoTxt(applied.a)}  →  Proposta: ${periodoTxt(applied.p)} — ${merged.length} linha(s)`
        : `${merged.length} linha(s) — mesma base do Resumo por Linha`;

      function drawHeader(d: InstanceType<typeof jsPDF>) {
        d.setTextColor(37, 99, 235); d.setFont("helvetica", "bold"); d.setFontSize(12);
        d.text("RELATÓRIO COMPARATIVO — ATUAL vs PROPOSTA", 10, 8);
        d.setFont("helvetica", "normal"); d.setFontSize(7); d.setTextColor(100);
        d.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, pageW - 10, 8, { align: "right" });
        d.setFontSize(6.8); d.setTextColor(90);
        d.text(subtitleTxt, 10, 13);
        d.setDrawColor(37, 99, 235); d.setLineWidth(0.5);
        d.line(10, 15, pageW - 10, 15);
        d.setTextColor(20);
      }

      const bodyCells = body.map((r) => r.map(cellFor));
      const footCells = tot.map(cellFor);

      function naturalWidth(fontSize: number) {
        const padX = 1.2 * (fontSize / 6.5);
        probe.setFontSize(fontSize);
        let total = 0;
        const nCols = header1.length;
        for (let c = 0; c < nCols; c++) {
          let maxW = 0;
          const cells = [String(header1[c] ?? ""), String(header2[c] ?? ""), ...bodyCells.map((r) => String(r[c] ?? "")), String(footCells[c] ?? "")];
          for (const cell of cells) {
            probe.setFont("helvetica", c === 0 ? "bold" : "normal");
            const w = probe.getTextWidth(cell);
            if (w > maxW) maxW = w;
          }
          total += maxW + padX * 2;
        }
        return total;
      }

      function draw(zoom: number, marginLeft: number) {
        const d = new jsPDF({ orientation, unit: "mm", format: "a4" });
        const fontSize = 6.5 * zoom;
        const padY = 1.2 * zoom;
        autoTable(d, {
          startY: HEADER_H + 3,
          head: [header1, header2],
          body: bodyCells,
          foot: [footCells],
          styles: { fontSize, cellPadding: padY, halign: "right", valign: "middle", lineColor: [180, 180, 180], lineWidth: 0.18 },
          columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
          headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: fontSize + 0.4, halign: "center", fontStyle: "bold" },
          footStyles: { fillColor: [219, 234, 254], textColor: 20, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          margin: { left: marginLeft, right: 8, top: HEADER_H + 3, bottom: 12 },
          theme: "grid",
          tableWidth: "wrap",
          showFoot: "lastPage",
          rowPageBreak: "avoid",
          didDrawPage: () => drawHeader(d),
        });
        const totalHeight = (d as any).lastAutoTable.finalY - (HEADER_H + 3);
        return { doc: d, pages: d.getNumberOfPages(), totalHeight };
      }

      const baseW = naturalWidth(6.5);
      const baseline = draw(1, 8);
      const zoom = Math.min(usableW / baseW, usableH / baseline.totalHeight);
      const finalW = naturalWidth(6.5 * zoom);
      const marginLeft = Math.max(5, (pageW - finalW) / 2);
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

  const printData = buildExportRows();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitCompare className="h-6 w-6 text-primary" /> Relatório Comparativo
          </h1>
          <p className="text-sm text-muted-foreground">
            Compare duas programações/versionamentos lado a lado, com diferença absoluta e percentual. Base e cálculos idênticos ao Resumo por Linha.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Regra serviço</span>
            <Select value={criterio} onValueChange={(v) => setCriterio(v as CriterioLinha)}>
              <SelectTrigger className="h-8 text-xs w-[210px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="predominancia">Predominância (mais partidas)</SelectItem>
                <SelectItem value="primeira_partida">Primeira partida</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <Checkbox checked={somenteAtivos} onCheckedChange={(v) => setSomenteAtivos(!!v)} className="h-3.5 w-3.5" />
            Somente ativos
          </label>

          <Button size="sm" onClick={() => setApplied({ a: atualFilters, p: propostaFilters })} disabled={loading}>
            Consultar
          </Button>
          {applied && <Button variant="outline" size="sm" onClick={() => setApplied(null)}>Limpar</Button>}
          <Button variant="outline" size="sm" onClick={exportXLSX} disabled={!merged.length}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Select value={ordenarPor} onValueChange={(v) => setOrdenarPor(v as any)}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="padrao">Ordem padrão</SelectItem>
              <SelectItem value="unidade">Ordenar por Unidade</SelectItem>
            </SelectContent>
          </Select>
          <PdfPreviewDialog
            build={buildPDF}
            filename={`relatorio_comparativo_${new Date().toISOString().slice(0, 10)}.pdf`}
            disabled={!merged.length}
            defaultOrientation="landscape"
            onDownload={(o) => void logAudit({ action: "export", entity: "relatorio_comparativo", details: { format: "pdf", orientation: o, rows: merged.length } })}
            onPrint={(o) => void logAudit({ action: "export", entity: "relatorio_comparativo", details: { format: "print", orientation: o, rows: merged.length } })}
          />
        </div>
      </div>

      {/* Visualização de impressão — some na tela normal, só aparece no
          diálogo de impressão do navegador (margens/escala/nº de páginas
          ajustados lá, com pré-visualização). */}
      <div className="print-only">
        <div style={{ fontWeight: 700, fontSize: "14pt", color: "#2563eb" }}>RELATÓRIO COMPARATIVO — ATUAL vs PROPOSTA</div>
        <div style={{ fontSize: "8pt", color: "#555", marginBottom: "6pt" }}>
          Gerado em {new Date().toLocaleString("pt-BR")} — {merged.length} linha(s)
        </div>
        <table className="print-table">
          <thead>
            <tr>{printData.header1.map((h, i) => <th key={i}>{h}</th>)}</tr>
            <tr>{printData.header2.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {printData.body.map((r, ri) => (
              <tr key={ri}>
                {r.map((v, i) => (
                  <td key={i} style={i === 0 ? { textAlign: "left", fontWeight: 600 } : undefined}>{cellFor(v, i)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {printData.tot.map((v, i) => (
                <td key={i} style={i === 0 ? { textAlign: "left" } : undefined}>{cellFor(v, i)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="print:hidden space-y-4">

      <div className="grid gap-3 md:grid-cols-2">
        <FilterBlock title="ATUAL" tone="atual" filters={atualFilters} setFilters={setAtualFilters} opts={opts} />
        <FilterBlock title="PROPOSTA" tone="proposta" filters={propostaFilters} setFilters={setPropostaFilters} opts={opts} />
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-3 flex flex-wrap items-center gap-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Campos visíveis</span>
          {METRICS.map((m) => (
            <label key={m.key as string} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox
                checked={visibleMetrics.has(m.key as string)}
                onCheckedChange={() => toggleMetric(m.key as string)}
                className="h-3.5 w-3.5"
              />
              {m.label}
            </label>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={showPct} onCheckedChange={(v) => setShowPct(!!v)} className="h-3.5 w-3.5" />
              Mostrar Δ%
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={onlyDiff} onCheckedChange={(v) => setOnlyDiff(!!v)} className="h-3.5 w-3.5" />
              Somente com diferença
            </label>
          </div>
        </CardContent>
      </Card>

      {applied && (kmSemCadastro.atual > 0 || kmSemCadastro.proposta > 0) && (
        <div className="w-full rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2">
          <span className="text-xs">Trechos sem KM cadastrado entram como 0 km — Atual: <strong>{kmSemCadastro.atual}</strong> viagem(ns); Proposta: <strong>{kmSemCadastro.proposta}</strong> viagem(ns).</span>
        </div>
      )}

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4" />
            Comparativo por Linha
            <Badge variant="outline" className="text-[10px]">{merged.length} linha(s)</Badge>
            <Badge variant="secondary" className="text-[10px]">Atual: {atualRows.length}</Badge>
            <Badge variant="secondary" className="text-[10px]">Proposta: {propostaRows.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {!applied ? (
            <p className="text-sm text-muted-foreground py-6">Configure os filtros de ATUAL e PROPOSTA e clique em <strong>Consultar</strong>.</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground py-6">Carregando...</p>
          ) : shownMetrics.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">Selecione ao menos um campo para comparar.</p>
          ) : !merged.length ? (
            <p className="text-sm text-muted-foreground py-6">Nenhum registro para os filtros aplicados.</p>
          ) : (
            <div className="overflow-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="h-8 border-b-2">
                    <TableHead rowSpan={2} className="px-2 py-1 align-bottom">Linha</TableHead>
                    {shownMetrics.map((m) => (
                      <TableHead
                        key={m.key as string}
                        colSpan={colsPerMetric}
                        className="px-2 py-1 text-center border-l"
                      >
                        {m.label}
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow className="h-7">
                    {shownMetrics.map((m) => (
                      <Fragment key={String(m.key)}>
                        <TableHead key={`${String(m.key)}-a`} className="px-2 py-1 text-right border-l text-[10px] uppercase tracking-wider text-blue-600">Atual</TableHead>
                        <TableHead key={`${String(m.key)}-p`} className="px-2 py-1 text-right text-[10px] uppercase tracking-wider text-emerald-600">Prop.</TableHead>
                        <TableHead key={`${String(m.key)}-d`} className="px-2 py-1 text-right text-[10px] uppercase tracking-wider">Δ</TableHead>
                        {showPct && (
                          <TableHead key={`${String(m.key)}-pct`} className="px-2 py-1 text-right text-[10px] uppercase tracking-wider">Δ%</TableHead>
                        )}
                      </Fragment>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {merged.map(({ linha, a, p }) => (
                    <TableRow key={linha} className="h-8">
                      <TableCell className="px-2 py-1 font-medium">{linha}</TableCell>
                      {shownMetrics.map((m) => {
                        const av = (a?.[m.key] as number) ?? 0;
                        const pv = (p?.[m.key] as number) ?? 0;
                        const d = pv - av;
                        const pct = diffPct(av, pv);
                        const dCls = d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "text-muted-foreground";
                        return (
                          <Fragment key={String(m.key)}>
                            <TableCell key={`${String(m.key)}-a`} className="px-2 py-1 text-right tabular-nums border-l">{m.fmt(av)}</TableCell>
                            <TableCell key={`${String(m.key)}-p`} className="px-2 py-1 text-right tabular-nums">{m.fmt(pv)}</TableCell>
                            <TableCell key={`${String(m.key)}-d`} className={`px-2 py-1 text-right tabular-nums font-semibold ${dCls}`}>{fmtDelta(d, m.fmt)}</TableCell>
                            {showPct && (
                              <TableCell key={`${String(m.key)}-pct`} className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{fmtPct(pct)}</TableCell>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold h-9">
                    <TableCell className="px-2 py-1">TOTAL</TableCell>
                    {shownMetrics.map((m) => {
                      const av = totals.a[m.key as string];
                      const pv = totals.p[m.key as string];
                      const d = pv - av;
                      const pct = diffPct(av, pv);
                      const dCls = d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "";
                      return (
                        <Fragment key={String(m.key)}>
                          <TableCell key={`${String(m.key)}-a`} className="px-2 py-1 text-right tabular-nums border-l">{m.fmt(av)}</TableCell>
                          <TableCell key={`${String(m.key)}-p`} className="px-2 py-1 text-right tabular-nums">{m.fmt(pv)}</TableCell>
                          <TableCell key={`${String(m.key)}-d`} className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{fmtDelta(d, m.fmt)}</TableCell>
                          {showPct && (
                            <TableCell key={`${String(m.key)}-pct`} className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{fmtPct(pct)}</TableCell>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
