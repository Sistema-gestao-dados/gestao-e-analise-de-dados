import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { fetchLinhas, fetchKm, fetchMulti, fetchEmpresaEstacao } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import { fetchProjetosAtivos, filterViagensAtivas } from "@/lib/projeto-ativo";
import {
  buildServiceUnits, aggregateByGroup, aggregateByLinha, dominantLinha, detectTUIncompletos, validarConsistenciaFrota,
  type ViagemLite, type AggRow, type ServiceUnit, type CriterioLinha,
} from "@/lib/resumo";
import { buildEmpresaOverrideMap, resolveEmpresaViagem, resolveGrupoViagem, buildEmpresaPorServico } from "@/lib/empresa-estacao";
import { buildKmMaps, viagemKm, viagemKmResult, fmtKm, fmtInt } from "@/lib/km";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bus, Users, Activity, Gauge, FileSpreadsheet, FileText, Layers, AlertTriangle, Play, RotateCcw, Printer } from "lucide-react";
import { MultiSelect } from "@/components/multi-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PdfPreviewDialog, type PdfOrientation } from "@/components/pdf-preview-dialog";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { usePersistentState } from "@/hooks/use-persistent-state";

const fetchViagens = fetchAllViagens;

function parseHHMM(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function KpiCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-3 flex items-center gap-2.5">
        <div className="h-9 w-9 rounded-md bg-primary/10 text-primary ring-1 ring-primary/20 flex items-center justify-center">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-lg font-bold tabular-nums leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
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

type Mode = "grupo" | "linha";

export function ResumoView({ mode }: { mode: Mode }) {
  useAuditView(mode === "linha" ? "resumo_linha" : "resumo_operacional");
  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const kmQ = useQuery({ queryKey: ["km"], queryFn: fetchKm });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const empresaEstacaoQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });

  const viagensRaw = viagensQ.data ?? [];
  const ativos = ativosQ.data ?? [];
  const [somenteAtivos, setSomenteAtivos] = usePersistentState(`resumo.${mode}.somenteAtivos`, true);
  const viagens = useMemo(
    () => (somenteAtivos ? filterViagensAtivas(viagensRaw, ativos) : viagensRaw),
    [viagensRaw, ativos, somenteAtivos],
  );
  const linhas = linhasQ.data ?? [];
  const km = kmQ.data ?? [];
  const multi = multiQ.data ?? [];
  const empresaEstacao = empresaEstacaoQ.data ?? [];

  const linhaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l])), [linhas]);
  const empresaOverrideMap = useMemo(() => buildEmpresaOverrideMap(empresaEstacao), [empresaEstacao]);
  const empresaPorServico = useMemo(
    () => buildEmpresaPorServico(viagens, linhaMap, empresaOverrideMap),
    [viagens, linhaMap, empresaOverrideMap],
  );
  const ordemMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l.ordem])), [linhas]);
  const kmMaps = useMemo(() => buildKmMaps(km), [km]);
  const grupoMap = useMemo(() => {
    const m = new Map<string, string>();
    multi.forEach((mu) => m.set(`${mu.linha}|${mu.tipo_dia}`.toLowerCase(), mu.grupo_du));
    return m;
  }, [multi]);

  const [groupBy, setGroupBy] = usePersistentState<"versao" | "grupo">(`resumo.${mode}.groupBy`, "versao");
  // FLAG: regra de contagem de serviço/frota por linha
  const [criterio, setCriterio] = usePersistentState<CriterioLinha>(`resumo.${mode}.criterio`, "predominancia");

  const [fDia, setFDia] = usePersistentState(`resumo.${mode}.fDia`, "__all");
  const [fLinha, setFLinha] = usePersistentState<string[]>(`resumo.${mode}.fLinha`, []);
  const [fGrupo, setFGrupo] = usePersistentState(`resumo.${mode}.fGrupo`, "__all");
  const [fCategoria, setFCategoria] = usePersistentState(`resumo.${mode}.fCategoria`, "__all");
  const [fEmpresa, setFEmpresa] = usePersistentState(`resumo.${mode}.fEmpresa`, "__all");
  const [fUnidade, setFUnidade] = usePersistentState(`resumo.${mode}.fUnidade`, "__all");
  const [fGrupoOrdem, setFGrupoOrdem] = usePersistentState(`resumo.${mode}.fGrupoOrdem`, "__all");
  const [fFaixa, setFFaixa] = usePersistentState(`resumo.${mode}.fFaixa`, "__all");
  const [fVersao, setFVersao] = usePersistentState(`resumo.${mode}.fVersao`, "__all");
  const [fOrigem, setFOrigem] = usePersistentState(`resumo.${mode}.fOrigem`, "__all");
  const [fDestino, setFDestino] = usePersistentState(`resumo.${mode}.fDestino`, "__all");

  // Snapshot dos filtros aplicados — só recalcula relatório ao clicar em Consultar.
  type Snap = { dia: string; linha: string[]; grupo: string; categoria: string; empresa: string; unidade: string; grupoOrdem: string; faixa: string; versao: string; origem: string; destino: string; groupBy: "versao" | "grupo"; criterio: CriterioLinha };
  const [applied, setApplied] = useState<Snap | null>(null);
  const S = applied ?? { dia: fDia, linha: fLinha, grupo: fGrupo, categoria: fCategoria, empresa: fEmpresa, unidade: fUnidade, grupoOrdem: fGrupoOrdem, faixa: fFaixa, versao: fVersao, origem: fOrigem, destino: fDestino, groupBy, criterio };


  const opts = useMemo(() => {
    const set = (fn: (v: ViagemLite) => string | null | undefined) =>
      Array.from(new Set(viagens.map(fn).filter(Boolean) as string[])).sort();
    return {
      dia: set((v) => v.tipo_operacao),
      linha: set((v) => v.linha),
      versao: set((v) => v.versao_programacao),
      origem: set((v) => v.origem),
      destino: set((v) => v.destino),
      faixa: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")),
      empresa: Array.from(new Set([
        ...linhas.map((l) => l.empresa).filter(Boolean) as string[],
        ...empresaEstacao.map((e) => e.empresa).filter(Boolean),
      ])).sort(),
      unidade: Array.from(new Set(linhas.map((l) => l.unidade).filter(Boolean) as string[])).sort(),
      grupoOrdem: Array.from(new Set([
        ...linhas.map((l) => l.ordem).filter(Boolean) as string[],
        ...empresaEstacao.map((e) => e.grupo).filter(Boolean) as string[],
      ])).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
      categoria: Array.from(new Set(linhas.map((l) => l.categoria).filter(Boolean) as string[])).sort(),
      grupo: Array.from(new Set(multi.map((m) => m.grupo_du).filter(Boolean))).sort(),
    };
  }, [viagens, linhas, multi, empresaEstacao]);

  const linhaSet = useMemo(() => new Set(S.linha), [S.linha]);

  // Predicado comum a TODOS os filtros exceto Linha. Usado para computar a
  // linha de origem do veículo (frota) sem que o filtro de linha distorça a
  // atribuição — um carro cuja origem é outra linha não deve ser reatribuído
  // à linha filtrada.
  const passesExceptLinha = useCallback((v: ViagemLite) => {
    if (S.dia !== "__all" && v.tipo_operacao !== S.dia) return false;
    if (S.versao !== "__all" && v.versao_programacao !== S.versao) return false;
    if (S.origem !== "__all" && v.origem !== S.origem) return false;
    if (S.destino !== "__all" && v.destino !== S.destino) return false;
    const l = linhaMap.get(v.linha);
    if (S.empresa !== "__all" && resolveEmpresaViagem(v, linhaMap, empresaOverrideMap) !== S.empresa) return false;
    if (S.unidade !== "__all" && l?.unidade !== S.unidade) return false;
    if (S.grupoOrdem !== "__all" && resolveGrupoViagem(v, linhaMap, empresaOverrideMap) !== S.grupoOrdem) return false;
    if (S.categoria !== "__all" && l?.categoria !== S.categoria) return false;
    if (S.grupo !== "__all") {
      const g = grupoMap.get(`${v.linha}|${v.tipo_operacao ?? ""}`.toLowerCase());
      if (g !== S.grupo) return false;
    }
    if (S.faixa !== "__all") {
      const m = parseHHMM(v.partida);
      if (m == null) return false;
      if (String(Math.floor(m / 60)).padStart(2, "0") !== S.faixa) return false;
    }
    return true;
  }, [S.dia, S.versao, S.origem, S.destino, S.empresa, S.unidade, S.grupoOrdem, S.categoria, S.grupo, S.faixa, linhaMap, grupoMap, empresaOverrideMap]);

  const filtered = useMemo(() => {
    if (!applied) return [] as ViagemLite[];
    return viagens.filter((v) => {
      if (linhaSet.size > 0 && !linhaSet.has(v.linha)) return false;
      return passesExceptLinha(v);
    });
  }, [viagens, applied, linhaSet, passesExceptLinha]);

  // Universo para cálculo de origem (frota): mesmos filtros SEM o de linha.
  const viagensParaOrigem = useMemo(() => {
    if (!applied) return [] as ViagemLite[];
    if (linhaSet.size === 0) return filtered;
    return viagens.filter(passesExceptLinha);
  }, [viagens, applied, linhaSet, filtered, passesExceptLinha]);

  const kmFn = useMemo(() => (v: ViagemLite) => viagemKm(v, kmMaps), [kmMaps]);
  const units = useMemo(() => buildServiceUnits(filtered, kmFn), [filtered, kmFn]);

  const rows: AggRow[] = useMemo(() => {
    if (!applied) return [];
    if (mode === "linha") return aggregateByLinha(units, filtered, ordemMap, viagensParaOrigem, S.criterio);
    if (S.groupBy === "grupo") {
      return aggregateByGroup(units, (u: ServiceUnit) => {
        const linha = dominantLinha(u, S.criterio);
        const td = S.dia !== "__all" ? S.dia : u.tipo_operacao;
        const g = grupoMap.get(`${linha}|${td}`.toLowerCase()) ?? `(sem grupo) ${linha}`;
        const ord = ordemMap.get(linha);
        return { key: g, label: g, order: ord == null ? undefined : ord };
      });
    }
    return aggregateByGroup(units, (u) => ({ key: u.versao, label: u.versao }));
  }, [applied, units, mode, S.groupBy, S.criterio, grupoMap, ordemMap, S.dia, filtered, viagensParaOrigem]);

  // Unidade (cadastro de Linhas) de cada linha de resumo. Em modo "linha", a
  // linha do relatório já É o código da linha — busca direto no cadastro.
  // Em modo "grupo" (grupo de linha ou versão), a linha do relatório agrega
  // várias linhas físicas, então usa a unidade predominante entre os
  // serviços que caem nesse grupo.
  const unidadePorGrupo = useMemo(() => {
    if (mode === "linha") {
      const out = new Map<string, string>();
      for (const l of linhas) if (l.unidade) out.set(l.linha, l.unidade);
      return out;
    }
    const tally = new Map<string, Map<string, number>>();
    for (const u of units.values()) {
      const linhaDom = dominantLinha(u, S.criterio);
      const unidade = linhaMap.get(linhaDom)?.unidade;
      if (!unidade) continue;
      let key: string;
      if (S.groupBy === "grupo") {
        const td = S.dia !== "__all" ? S.dia : u.tipo_operacao;
        key = grupoMap.get(`${linhaDom}|${td}`.toLowerCase()) ?? `(sem grupo) ${linhaDom}`;
      } else {
        key = u.versao;
      }
      const m = tally.get(key) ?? new Map<string, number>();
      m.set(unidade, (m.get(unidade) ?? 0) + 1);
      tally.set(key, m);
    }
    const out = new Map<string, string>();
    for (const [key, m] of tally) {
      let best: string | null = null, bestN = -1;
      for (const [un, n] of m) if (n > bestN) { best = un; bestN = n; }
      if (best) out.set(key, best);
    }
    return out;
  }, [units, mode, S.groupBy, S.criterio, S.dia, grupoMap, linhaMap, linhas]);

  const [ordenarPor, setOrdenarPor] = usePersistentState<"padrao" | "unidade">(`resumo.${mode}.ordenarPor`, "padrao");

  const displayRows = useMemo(() => {
    if (ordenarPor !== "unidade") return rows;
    return [...rows].sort((a, b) => {
      const ua = unidadePorGrupo.get(a.groupKey) ?? "";
      const ub = unidadePorGrupo.get(b.groupKey) ?? "";
      if (ua !== ub) return ua.localeCompare(ub, "pt-BR");
      return a.groupLabel.localeCompare(b.groupLabel, "pt-BR");
    });
  }, [rows, ordenarPor, unidadePorGrupo]);


const totals = useMemo(() => {
    const acc = rows.reduce(
      (acc, r) => ({
        dir1: acc.dir1 + r.dir1, dir2: acc.dir2 + r.dir2, aprov: acc.aprov + r.aprov, tu: acc.tu + r.tu,
        totalServico: acc.totalServico + r.totalServico, frota: 0,
        partidas: acc.partidas + r.partidas, km: acc.km + r.km,
      }),
      { dir1: 0, dir2: 0, aprov: 0, tu: 0, totalServico: 0, frota: 0, partidas: 0, km: 0 },
    );
    // Frota do TOTAL = veículos físicos ÚNICOS em todo o conjunto (não é soma
    // das colunas Frota de cada linha, pois um mesmo veículo pode operar em
    // mais de uma linha e seria contado mais de uma vez).
    acc.frota = new Set(Array.from(units.values()).map((u) => u.vehicleKey)).size;
    return acc;
  }, [rows, units]);
  // Alerta: TU sem os dois turnos completos (erro de cadastro)
  const tuIncompletos = useMemo(() => detectTUIncompletos(units, filtered), [units, filtered]);
  const [showTU, setShowTU] = usePersistentState(`resumo.${mode}.showTU`, false);
  const [showKm, setShowKm] = usePersistentState(`resumo.${mode}.showKm`, false);

  // Validação obrigatória da regra de Frota: soma por linha == veículos distintos
  const frotaValidacao = useMemo(() => validarConsistenciaFrota(units, viagensParaOrigem), [units, viagensParaOrigem]);

  const kmSemCadastro = useMemo(() => {
    const trechos = new Map<string, { linha: string; origem: string; destino: string; viagens: number }>();
    for (const v of filtered) {
      if (viagemKmResult(v, kmMaps).fonte !== "sem_cadastro") continue;
      const key = `${v.linha}||${v.origem ?? ""}||${v.destino ?? ""}`;
      const atual = trechos.get(key);
      if (atual) atual.viagens += 1;
      else trechos.set(key, { linha: v.linha, origem: v.origem ?? "—", destino: v.destino ?? "—", viagens: 1 });
    }
    return Array.from(trechos.values()).sort((a, b) => b.viagens - a.viagens);
  }, [filtered, kmMaps]);

  // Resumo por empresa (rodapé gerencial)
  const resumoEmpresa = useMemo(() => {
    const m = new Map<string, { partidas: number; km: number; servicos: Set<string>; veiculos: Set<string> }>();
    for (const u of units.values()) {
      const empresaServico = empresaPorServico.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, S.criterio))?.empresa || "Sem empresa";
      if (!m.has(empresaServico)) m.set(empresaServico, { partidas: 0, km: 0, servicos: new Set(), veiculos: new Set() });
      m.get(empresaServico)!.servicos.add(u.key);
      m.get(empresaServico)!.veiculos.add(u.vehicleKey);
    }
    for (const v of filtered) {
      const e = resolveEmpresaViagem(v, linhaMap, empresaOverrideMap) || "Sem empresa";
      if (!m.has(e)) m.set(e, { partidas: 0, km: 0, servicos: new Set(), veiculos: new Set() });
      if ((v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL" && v.partida) m.get(e)!.partidas += 1;
      m.get(e)!.km += kmFn(v);
    }
    return Array.from(m, ([empresa, x]) => ({
      empresa, partidas: x.partidas, km: x.km, servicos: x.servicos.size, frota: x.veiculos.size,
    })).sort((a, b) => a.empresa.localeCompare(b.empresa));
  }, [units, filtered, linhaMap, kmFn, S.criterio, empresaPorServico, empresaOverrideMap]);

  const title = mode === "linha" ? "Resumo por Linha" : "Resumo Operacional";
  const firstColLabel = mode === "linha" ? "Linha" : (groupBy === "grupo" ? "Grupo de Linha" : "Projeto / Versão");
  const headers = [firstColLabel, "Dir 1º T.", "Dir 2º T.", "Aproveit.", "TU", "Serviços", "Frota", "Partidas", "KM Total"];

  function exportXLSX() {
    const wb = XLSX.utils.book_new();
    // Aba principal
    const aoa: (string | number)[][] = [
      [title.toUpperCase()],
      [`Gerado em ${new Date().toLocaleString("pt-BR")} — ${rows.length} ${mode === "linha" ? "linha(s)" : "grupo(s)"}`],
      [],
      headers,
      ...displayRows.map((r) => [
        r.groupLabel, r.dir1, r.dir2, r.aprov, r.tu, r.totalServico, r.frota, r.partidas,
        Number(r.km.toFixed(1)),
      ]),
      ["TOTAL", totals.dir1, totals.dir2, totals.aprov, totals.tu, totals.totalServico, totals.frota, totals.partidas, Number(totals.km.toFixed(1))],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
    ];
    ws["!cols"] = [
      { wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));

    // Aba Empresa
    const empAoa: (string | number)[][] = [
      ["RESUMO GERENCIAL POR EMPRESA"],
      [],
      ["Empresa", "Serviços", "Frota", "Partidas", "KM"],
      ...resumoEmpresa.map((e) => [e.empresa, e.servicos, e.frota, e.partidas, Number(e.km.toFixed(1))]),
      ["TOTAL",
        resumoEmpresa.reduce((s, e) => s + e.servicos, 0),
        resumoEmpresa.reduce((s, e) => s + e.frota, 0),
        resumoEmpresa.reduce((s, e) => s + e.partidas, 0),
        Number(resumoEmpresa.reduce((s, e) => s + e.km, 0).toFixed(1)),
      ],
    ];
    const wsEmp = XLSX.utils.aoa_to_sheet(empAoa);
    wsEmp["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
    wsEmp["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsEmp, "Resumo Empresa");

    XLSX.writeFile(wb, `${title.replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    void logAudit({ action: "export", entity: mode === "linha" ? "resumo_linha" : "resumo_operacional", details: { format: "xlsx", rows: rows.length } });
  }

  function buildPDF(orientation: PdfOrientation) {
      const probe = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const pageW = probe.internal.pageSize.getWidth();
      const pageH = probe.internal.pageSize.getHeight();
      const HEADER_H = 16;
      const usableW = pageW - 20;
      const usableH = pageH - (HEADER_H + 3) - 12;

      const periodoTxt = [
        S.dia !== "__all" ? S.dia : "Todos os dias",
        S.versao !== "__all" ? `Versão ${S.versao}` : null,
      ].filter(Boolean).join(" · ");
      const subtitleTxt = `Período: ${periodoTxt} — ${rows.length} ${mode === "linha" ? "linha(s)" : "grupo(s)"} · TU único · Frota = veículos físicos distintos`;

      function drawHeader(d: InstanceType<typeof jsPDF>) {
        d.setTextColor(37, 99, 235); d.setFont("helvetica", "bold"); d.setFontSize(12);
        d.text(title.toUpperCase(), 10, 8);
        d.setFont("helvetica", "normal"); d.setFontSize(7); d.setTextColor(100);
        d.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, pageW - 10, 8, { align: "right" });
        d.setFontSize(6.8); d.setTextColor(90);
        d.text(subtitleTxt, 10, 13);
        d.setDrawColor(37, 99, 235); d.setLineWidth(0.5);
        d.line(10, 15, pageW - 10, 15);
        d.setTextColor(20);
      }

      const mainBody = displayRows.map((r) => [
        r.groupLabel, fmtInt(r.dir1), fmtInt(r.dir2), fmtInt(r.aprov), fmtInt(r.tu),
        fmtInt(r.totalServico), fmtInt(r.frota), fmtInt(r.partidas), fmtKm(r.km),
      ]);
      const mainFoot = ["TOTAL", fmtInt(totals.dir1), fmtInt(totals.dir2), fmtInt(totals.aprov), fmtInt(totals.tu),
        fmtInt(totals.totalServico), fmtInt(totals.frota), fmtInt(totals.partidas), fmtKm(totals.km)];
      const empBody = resumoEmpresa.map((e) => [e.empresa, fmtInt(e.servicos), fmtInt(e.frota), fmtInt(e.partidas), fmtKm(e.km)]);
      const empHeaders = ["Empresa", "Serviços", "Frota", "Partidas", "KM"];
      const empFoot = ["TOTAL",
        fmtInt(resumoEmpresa.reduce((s, e) => s + e.servicos, 0)),
        fmtInt(resumoEmpresa.reduce((s, e) => s + e.frota, 0)),
        fmtInt(resumoEmpresa.reduce((s, e) => s + e.partidas, 0)),
        fmtKm(resumoEmpresa.reduce((s, e) => s + e.km, 0)),
      ];

      // Largura natural calculada só com getTextWidth (API padrão do jsPDF).
      function tableNaturalWidth(fontSize: number, headerRow: string[], bodyRows: any[][], footRow: any[]) {
        const padX = 2 * (fontSize / 8);
        probe.setFontSize(fontSize);
        let total = 0;
        for (let c = 0; c < headerRow.length; c++) {
          let maxW = 0;
          const cellsInCol = [headerRow[c], ...bodyRows.map((r) => r[c]), footRow[c]];
          for (const cell of cellsInCol) {
            probe.setFont("helvetica", c === 0 ? "bold" : "normal");
            const w = probe.getTextWidth(String(cell ?? ""));
            if (w > maxW) maxW = w;
          }
          total += maxW + padX * 2;
        }
        return total;
      }
      function naturalWidth(fontSize: number) {
        const mainW = tableNaturalWidth(fontSize, headers, mainBody, mainFoot);
        const empW = tableNaturalWidth(fontSize - 0.3, empHeaders, empBody, empFoot);
        return Math.max(mainW, empW);
      }

      function draw(zoom: number, marginLeft: number) {
        const d = new jsPDF({ orientation, unit: "mm", format: "a4" });
        const fontSize = 8 * zoom;
        const padY = 1.5 * zoom;
        autoTable(d, {
          startY: HEADER_H + 3,
          head: [headers],
          body: mainBody,
          foot: [mainFoot],
          styles: { fontSize, cellPadding: { top: padY, right: 2 * zoom, bottom: padY, left: 2 * zoom }, halign: "right", valign: "middle", overflow: "linebreak", lineColor: [180, 180, 180], lineWidth: 0.18 },
          columnStyles: {
            0: { halign: "left", fontStyle: "bold" },
            5: { fontStyle: "bold" },
            6: { fontStyle: "bold" },
          },
          headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: fontSize + 0.5, halign: "center", fontStyle: "bold", cellPadding: padY + 0.4 * zoom },
          footStyles: { fillColor: [219, 234, 254], textColor: 20, fontStyle: "bold", halign: "right" },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          margin: { left: marginLeft, right: 10, top: HEADER_H + 3, bottom: 12 },
          theme: "grid",
          tableWidth: "wrap",
          showFoot: "lastPage",
          rowPageBreak: "avoid",
          didDrawPage: () => drawHeader(d),
        });
        const afterY = (d as any).lastAutoTable.finalY + 8 * zoom;
        d.setFontSize(10 * zoom); d.setFont("helvetica", "bold"); d.setTextColor(20);
        d.text("Resumo Gerencial por Empresa", marginLeft, afterY);
        autoTable(d, {
          startY: afterY + 2 * zoom,
          head: [empHeaders],
          body: empBody,
          foot: [empFoot],
          styles: { fontSize: fontSize - 0.3, cellPadding: Math.max(padY - 0.2 * zoom, 0.3), halign: "right", valign: "middle", lineColor: [180, 180, 180], lineWidth: 0.18 },
          columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
          headStyles: { fillColor: [37, 99, 235], textColor: 255, halign: "center", fontStyle: "bold", cellPadding: 1.6 * zoom },
          footStyles: { fillColor: [219, 234, 254], textColor: 20, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          margin: { left: marginLeft, right: 10, top: HEADER_H + 3, bottom: 12 },
          theme: "grid",
          tableWidth: "wrap",
          rowPageBreak: "avoid",
          didDrawPage: () => drawHeader(d),
        });
        const totalHeight = (d as any).lastAutoTable.finalY - (HEADER_H + 3);
        return { doc: d, pages: d.getNumberOfPages(), totalHeight };
      }

      const baseW = naturalWidth(8);
      const baseline = draw(1, 10);
      const zoom = Math.min(usableW / baseW, usableH / baseline.totalHeight);
      const finalW = naturalWidth(8 * zoom);
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

  const pdfEntity = mode === "linha" ? "resumo_linha" : "resumo_operacional";
  const pdfFilename = `${title.replace(/\s+/g, "_").toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`;

  const loading = viagensQ.isLoading || linhasQ.isLoading || kmQ.isLoading || multiQ.isLoading;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "linha"
              ? "Detalhamento por linha (ordenação pelo campo ORDEM do cadastro). Frota = veículos físicos distintos (pico); mesmo serviço em T1+T2 conta como 1 veículo."
              : "Consolidado por projeto/versão ou grupo de linha. TU contabilizado uma única vez; Aproveitamento = 3º turno. Frota = veículos físicos (pico)."}
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
          {mode === "grupo" && (
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
              <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="versao">Agrupar por Projeto/Versão</SelectItem>
                <SelectItem value="grupo">Agrupar por Grupo de Linha</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={exportXLSX} disabled={!rows.length}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
          <PdfPreviewDialog
            build={buildPDF}
            filename={pdfFilename}
            disabled={!rows.length}
            onDownload={(o) => void logAudit({ action: "export", entity: pdfEntity, details: { format: "pdf", orientation: o, rows: rows.length } })}
            onPrint={(o) => void logAudit({ action: "export", entity: pdfEntity, details: { format: "print", orientation: o, rows: rows.length } })}
          />
        </div>
      </div>

      {/* Visualização de impressão — some na tela normal, só aparece no
          diálogo de impressão do navegador. O navegador cuida de margens,
          escala ("ajustar à página") e nº de páginas, com pré-visualização
          antes de imprimir ou salvar como PDF. */}
      <div className="print-only">
        <div style={{ fontWeight: 700, fontSize: "14pt", color: "#2563eb" }}>{title.toUpperCase()}</div>
        <div style={{ fontSize: "8pt", color: "#555", marginBottom: "6pt" }}>
          Gerado em {new Date().toLocaleString("pt-BR")} · Período: {[
            S.dia !== "__all" ? S.dia : "Todos os dias",
            S.versao !== "__all" ? `Versão ${S.versao}` : null,
          ].filter(Boolean).join(" · ")} — {rows.length} {mode === "linha" ? "linha(s)" : "grupo(s)"}
        </div>
        <table className="print-table">
          <thead>
            <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.groupKey}>
                <td style={{ textAlign: "left", fontWeight: 600 }}>{r.groupLabel}</td>
                <td>{fmtInt(r.dir1)}</td>
                <td>{fmtInt(r.dir2)}</td>
                <td>{fmtInt(r.aprov)}</td>
                <td>{fmtInt(r.tu)}</td>
                <td style={{ fontWeight: 600 }}>{fmtInt(r.totalServico)}</td>
                <td style={{ fontWeight: 600 }}>{fmtInt(r.frota)}</td>
                <td>{fmtInt(r.partidas)}</td>
                <td>{fmtKm(r.km)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ textAlign: "left" }}>TOTAL</td>
              <td>{fmtInt(totals.dir1)}</td>
              <td>{fmtInt(totals.dir2)}</td>
              <td>{fmtInt(totals.aprov)}</td>
              <td>{fmtInt(totals.tu)}</td>
              <td>{fmtInt(totals.totalServico)}</td>
              <td>{fmtInt(totals.frota)}</td>
              <td>{fmtInt(totals.partidas)}</td>
              <td>{fmtKm(totals.km)}</td>
            </tr>
          </tfoot>
        </table>

        <div style={{ fontWeight: 700, fontSize: "11pt", margin: "10pt 0 4pt" }}>Resumo Gerencial por Empresa</div>
        <table className="print-table">
          <thead>
            <tr><th>Empresa</th><th>Serviços</th><th>Frota</th><th>Partidas</th><th>KM</th></tr>
          </thead>
          <tbody>
            {resumoEmpresa.map((e) => (
              <tr key={e.empresa}>
                <td style={{ textAlign: "left", fontWeight: 600 }}>{e.empresa}</td>
                <td>{fmtInt(e.servicos)}</td>
                <td>{fmtInt(e.frota)}</td>
                <td>{fmtInt(e.partidas)}</td>
                <td>{fmtKm(e.km)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ textAlign: "left" }}>TOTAL</td>
              <td>{fmtInt(resumoEmpresa.reduce((s, e) => s + e.servicos, 0))}</td>
              <td>{fmtInt(resumoEmpresa.reduce((s, e) => s + e.frota, 0))}</td>
              <td>{fmtInt(resumoEmpresa.reduce((s, e) => s + e.partidas, 0))}</td>
              <td>{fmtKm(resumoEmpresa.reduce((s, e) => s + e.km, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* O restante da tela (filtros, tabela interativa) não deve imprimir */}
      <div className="print:hidden space-y-4">

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-3 flex flex-wrap gap-2">
          <FilterSelect label="Dia tipo" value={fDia} onChange={setFDia} options={opts.dia} />
          <MultiSelect label="Linha" values={fLinha} onChange={setFLinha} options={opts.linha} placeholder="Todas" />
          <FilterSelect label="Grupo de Linha" value={fGrupo} onChange={setFGrupo} options={opts.grupo} />
          <FilterSelect label="Tipo (Categoria)" value={fCategoria} onChange={setFCategoria} options={opts.categoria} />
          <FilterSelect label="Empresa" value={fEmpresa} onChange={setFEmpresa} options={opts.empresa} />
          <FilterSelect label="Unidade" value={fUnidade} onChange={setFUnidade} options={opts.unidade} />
          <FilterSelect label="Grupo" value={fGrupoOrdem} onChange={setFGrupoOrdem} options={opts.grupoOrdem} />
          <FilterSelect label="Projeto / Versão" value={fVersao} onChange={setFVersao} options={opts.versao} />
          <FilterSelect label="Origem" value={fOrigem} onChange={setFOrigem} options={opts.origem} />
          <FilterSelect label="Destino" value={fDestino} onChange={setFDestino} options={opts.destino} />
          <FilterSelect label="Faixa horária" value={fFaixa} onChange={setFFaixa} options={opts.faixa} />
          <div className="flex flex-col gap-1 min-w-[230px]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Regra de contagem de serviço</label>
            <Select value={criterio} onValueChange={(v) => setCriterio(v as CriterioLinha)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="predominancia">Predominância (mais partidas na linha)</SelectItem>
                <SelectItem value="primeira_partida">Primeira partida do serviço</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-end gap-2 text-xs cursor-pointer select-none pb-1">
            <Checkbox checked={somenteAtivos} onCheckedChange={(v) => setSomenteAtivos(!!v)} />
            Somente projetos ativos
          </label>
          <div className="flex items-end gap-2 ml-auto">
            <Button
              size="sm"
              onClick={() => setApplied({ dia: fDia, linha: fLinha, grupo: fGrupo, categoria: fCategoria, empresa: fEmpresa, unidade: fUnidade, grupoOrdem: fGrupoOrdem, faixa: fFaixa, versao: fVersao, origem: fOrigem, destino: fDestino, groupBy, criterio })}
              disabled={viagensQ.isLoading}
            >
              <Play className="h-4 w-4 mr-1" /> Consultar
            </Button>
            {applied && (
              <Button variant="outline" size="sm" onClick={() => setApplied(null)}>
                <RotateCcw className="h-4 w-4 mr-1" /> Limpar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {tuIncompletos.length > 0 && (
        <button
          type="button"
          onClick={() => setShowTU(true)}
          className="w-full text-left rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-center gap-2 hover:bg-warning/20 transition"
        >
          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          <span className="text-xs">
            <strong>{tuIncompletos.length}</strong> serviço(s) TU sem os dois turnos completos (T1 e T2) — clique para ver.
          </span>
        </button>
      )}

      {mode === "linha" && applied && !frotaValidacao.ok && (
        <div className="w-full text-left rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-xs">{frotaValidacao.mensagem}</span>
        </div>
      )}

      {applied && kmSemCadastro.length > 0 && (
        <button
          type="button"
          onClick={() => setShowKm(true)}
          className="w-full text-left rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2 hover:bg-warning/20 transition"
        >
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <span className="text-xs">
            <strong>{kmSemCadastro.reduce((s, t) => s + t.viagens, 0)}</strong> viagem(ns) em <strong>{kmSemCadastro.length}</strong> trecho(s) sem KM cadastrado foram contabilizadas com 0 km — clique para ver. Cadastre os trechos em Cadastro de KM para completar o total.
          </span>
        </button>
      )}

      <Dialog open={showKm} onOpenChange={setShowKm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Trechos sem KM cadastrado ({kmSemCadastro.length})</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-auto text-sm">
            <Table>
              <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead>Origem</TableHead><TableHead>Destino</TableHead><TableHead className="text-right">Viagens</TableHead></TableRow></TableHeader>
              <TableBody>
                {kmSemCadastro.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{t.linha}</TableCell>
                    <TableCell>{t.origem}</TableCell>
                    <TableCell>{t.destino}</TableCell>
                    <TableCell className="text-right">{t.viagens}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>


      <Dialog open={showTU} onOpenChange={setShowTU}>
        <DialogContent>
          <DialogHeader><DialogTitle>Serviços TU incompletos ({tuIncompletos.length})</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-auto text-sm">
            <Table>
              <TableHeader><TableRow><TableHead>Versão</TableHead><TableHead>Serviço</TableHead><TableHead>Turnos presentes</TableHead></TableRow></TableHeader>
              <TableBody>
                {tuIncompletos.map((t, i) => (
                  <TableRow key={i}>
                    <TableCell>{t.versao}</TableCell>
                    <TableCell className="font-medium">{t.servico}</TableCell>
                    <TableCell>{t.turnosPresentes.length ? t.turnosPresentes.map((x) => `T${x}`).join(", ") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>


      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Serviços" value={fmtInt(totals.totalServico)} icon={Activity} />
        <KpiCard label="Frota (Veículos)" value={fmtInt(totals.frota)} icon={Bus} />
        <KpiCard label="Motoristas" value={fmtInt(totals.totalServico)} icon={Users} />
        <KpiCard label="Partidas" value={fmtInt(totals.partidas)} icon={Activity} />
        <KpiCard label="KM Total" value={fmtKm(totals.km)} icon={Gauge} />
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4" />
            {title} <Badge variant="outline" className="text-[10px]">{rows.length} {mode === "linha" ? "linha(s)" : "grupo(s)"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {!applied ? (
            <p className="text-sm text-muted-foreground py-6">Aplique os filtros e clique em <strong>Consultar</strong> para carregar o relatório.</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground py-6">Carregando...</p>
          ) : !rows.length ? (
            <p className="text-sm text-muted-foreground py-6">Nenhum registro para os filtros aplicados.</p>
          ) : (
            <div className="overflow-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="h-8">
                    {headers.map((h, i) => (
                      <TableHead key={h} className={`px-2 py-1 ${i === 0 ? "" : "text-right"}`}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayRows.map((r) => (
                    <TableRow key={r.groupKey} className="h-8">
                      <TableCell className="px-2 py-1 font-medium">{r.groupLabel}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{r.dir1}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{r.dir2}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{r.aprov}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{r.tu}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums font-semibold">{r.totalServico}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums font-semibold">{r.frota}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtInt(r.partidas)}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtKm(r.km)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold h-9">
                    <TableCell className="px-2 py-1">TOTAL</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{totals.dir1}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{totals.dir2}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{totals.aprov}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{totals.tu}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{totals.totalServico}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{totals.frota}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{fmtInt(totals.partidas)}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{fmtKm(totals.km)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resumo Gerencial por Empresa */}
      {!loading && resumoEmpresa.length > 0 && (
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Resumo Gerencial por Empresa</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="h-8">
                    <TableHead className="px-2 py-1">Empresa</TableHead>
                    <TableHead className="px-2 py-1 text-right">Serviços</TableHead>
                    <TableHead className="px-2 py-1 text-right">Frota</TableHead>
                    <TableHead className="px-2 py-1 text-right">Partidas</TableHead>
                    <TableHead className="px-2 py-1 text-right">KM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumoEmpresa.map((e) => (
                    <TableRow key={e.empresa} className="h-8">
                      <TableCell className="px-2 py-1 font-medium">{e.empresa}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{e.servicos}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{e.frota}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtInt(e.partidas)}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{fmtKm(e.km)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold h-9">
                    <TableCell className="px-2 py-1">TOTAL</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{resumoEmpresa.reduce((s, e) => s + e.servicos, 0)}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{resumoEmpresa.reduce((s, e) => s + e.frota, 0)}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{fmtInt(resumoEmpresa.reduce((s, e) => s + e.partidas, 0))}</TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums">{fmtKm(resumoEmpresa.reduce((s, e) => s + e.km, 0))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
