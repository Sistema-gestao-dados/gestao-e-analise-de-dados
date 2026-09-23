// Relatório Comparativo — compara duas seleções (ATUAL vs PROPOSTA) usando
// exatamente a mesma base e pipeline do "Resumo por Linha":
//   buildServiceUnits -> aggregateByLinha -> AggRow
// Reaproveita todos os filtros já existentes e todos os campos (dir1, dir2,
// aprov, tu, serviços, frota, partidas, KM). Novos campos adicionados no
// tipo AggRow futuramente aparecem automaticamente via METRICS.

import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { fetchDiaTipoHeranca, buildDiaTipoHerancaMap } from "@/components/dia-tipo-mapper";
import { fetchLinhas, fetchKm, fetchMulti, fetchEmpresaEstacao, type Linha, type ParametroMulti } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import {
  buildServiceUnits, aggregateByLinha, aggregateByGroup, dominantLinha,
  type ViagemLite, type AggRow, type CriterioLinha, type ServiceUnit,
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
// xlsx-js-style (fork da SheetJS community, mesma API) em vez de "xlsx" puro:
// a "xlsx" comunidade NÃO escreve estilo de célula (cor de fundo/fonte) no
// arquivo gerado — só a versão paga faz isso. Testado: `.s` era silenciosamente
// ignorado no XLSX salvo. Precisamos de cor pro cabeçalho azul do PDF/Excel
// "por Unidade" ficarem iguais.
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PdfPreviewDialog, type PdfOrientation } from "@/components/pdf-preview-dialog";
import { logAudit } from "@/lib/audit";
import { buildJornadas, fmtDur } from "@/lib/jornada";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { buildEmpresaOverrideMap, resolveEmpresaViagem, resolveGrupoViagem, resolveUnidadeViagem, buildEmpresaPorServico, buildGrupoPorServico, buildUnidadePorServico, type EmpresaOverrideMap } from "@/lib/empresa-estacao";
import { custoServico, fmtMoeda } from "@/lib/custo";
import { useSalarioMotorista } from "@/components/salario-motorista";

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
  grupoOrdem: string;
  faixa: string;
  versao: string;
  origem: string;
  destino: string;
};

const EMPTY_FILTERS: Filters = {
  dia: "__all", linha: [], grupo: "__all", categoria: "__all", empresa: "__all", unidade: "__all", grupoOrdem: "__all",
  faixa: "__all", versao: "__all", origem: "__all", destino: "__all",
};

function passesExceptLinha(
  v: ViagemLite,
  f: Filters,
  linhaMap: Map<string, Linha>,
  grupoMap: Map<string, string>,
  empresaOverrideMap: EmpresaOverrideMap,
): boolean {
  if (f.dia !== "__all" && v.tipo_operacao !== f.dia) return false;
  if (f.versao !== "__all" && v.versao_programacao !== f.versao) return false;
  if (f.origem !== "__all" && v.origem !== f.origem) return false;
  if (f.destino !== "__all" && v.destino !== f.destino) return false;
  const l = linhaMap.get(v.linha);
  if (f.empresa !== "__all" && resolveEmpresaViagem(v, linhaMap, empresaOverrideMap) !== f.empresa) return false;
  if (f.unidade !== "__all" && resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) !== f.unidade) return false;
  if (f.grupoOrdem !== "__all" && resolveGrupoViagem(v, linhaMap, empresaOverrideMap) !== f.grupoOrdem) return false;
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
  empresaOverrideMap: EmpresaOverrideMap,
): ViagemLite[] {
  const linhaSet = new Set(f.linha);
  return viagens.filter((v) => {
    if (linhaSet.size > 0 && !linhaSet.has(v.linha)) return false;
    return passesExceptLinha(v, f, linhaMap, grupoMap, empresaOverrideMap);
  });
}

// Universo de viagens SEM aplicar o filtro de linha — usado para determinar
// a linha de origem do veículo (regra de frota). Ver aggregateByLinha.
function applyFiltersSemLinha(
  viagens: ViagemLite[],
  f: Filters,
  linhaMap: Map<string, Linha>,
  grupoMap: Map<string, string>,
  empresaOverrideMap: EmpresaOverrideMap,
): ViagemLite[] {
  return viagens.filter((v) => passesExceptLinha(v, f, linhaMap, grupoMap, empresaOverrideMap));
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
        <FilterSelect label="Grupo" value={filters.grupoOrdem} onChange={(v) => set("grupoOrdem", v)} options={opts.grupoOrdem} />
        <FilterSelect label="Origem" value={filters.origem} onChange={(v) => set("origem", v)} options={opts.origem} />
        <FilterSelect label="Destino" value={filters.destino} onChange={(v) => set("destino", v)} options={opts.destino} />
        <FilterSelect label="Faixa horária" value={filters.faixa} onChange={(v) => set("faixa", v)} options={opts.faixa} />
      </CardContent>
    </Card>
  );
}

function buildOpts(viagens: ViagemLite[], linhas: Linha[], multi: ParametroMulti[], empresaEstacao: { empresa: string; grupo: string | null }[] = []) {
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

// ---------------------------------------------------------------------------
// Exportação "por Unidade" (PDF retrato + Excel) — modelo pedido pelo usuário:
// um bloco por Unidade, cada um com Serviços/Frota/Partidas/KM (Atual,
// Proposta, Δ, Δ%), cabeçalho azul e total em azul claro, e um resumo final
// por Unidade. Só usado no modo "por linha" (agruparPorGrupo === false).
// ---------------------------------------------------------------------------
const PDF_BLUE: [number, number, number] = [68, 114, 196]; // #4472C4
const PDF_BLUE_LIGHT: [number, number, number] = [219, 234, 254]; // #DBEAFE
const PDF_LINE_BLUE: [number, number, number] = [37, 99, 235]; // #2563eb
const XLSX_BLUE = "4472C4";
const XLSX_BLUE_LIGHT = "DBEAFE";
const XLSX_LINE_BLUE = "2563EB";

const METRIC_KEYS = ["servicos", "frota", "partidas", "km"] as const;
type MetricKeyName = (typeof METRIC_KEYS)[number];

const UNIDADE_REPORT_METRICS: { key: MetricKeyName; label: string; fmt: (n: number) => string; deltaLabel: string; pctLabel: string }[] = [
  { key: "servicos", label: "Serviços", fmt: fmtInt, deltaLabel: "Δ", pctLabel: "%" },
  { key: "frota", label: "Frota", fmt: fmtInt, deltaLabel: "Δ", pctLabel: "Δ%" },
  { key: "partidas", label: "Partidas", fmt: fmtInt, deltaLabel: "Δ", pctLabel: "Δ%" },
  // KM usa "DIF" em vez de "Δ" — igual ao modelo manual do usuário.
  { key: "km", label: "KM", fmt: (n) => fmtKm(n), deltaLabel: "DIF", pctLabel: "Δ%" },
];
const UNIDADE_TOTAL_COLS = 1 + UNIDADE_REPORT_METRICS.length * 4; // Linha/Unidade + 4 grupos x 4 subcolunas
const UNIDADE_REAL_HEADER_ROW = ["Linha", ...UNIDADE_REPORT_METRICS.flatMap((m) => ["Atual", "Proposta", m.deltaLabel, m.pctLabel])];
// Mesmo cabeçalho, mas sem o caractere "Δ" — a fonte padrão do jsPDF
// (Helvetica/WinAnsi) não tem glifo pra letra grega, vira "mojibake" no PDF.
// Excel usa UNIDADE_REAL_HEADER_ROW (Δ de verdade); PDF usa esta.
const UNIDADE_REAL_HEADER_ROW_PDF = UNIDADE_REAL_HEADER_ROW.map((s) => s.replace(/Δ/g, "Dif"));
const UNIDADE_SUBHEADER_ROW = ["", ...UNIDADE_REPORT_METRICS.flatMap((m) => [m.label, "", "", ""])];

function fromAgg(r: AggRow | null): Record<MetricKeyName, number> {
  return { servicos: r?.totalServico ?? 0, frota: r?.frota ?? 0, partidas: r?.partidas ?? 0, km: r?.km ?? 0 };
}
function fromBreakdown(r: BreakdownVal | null): Record<MetricKeyName, number> {
  return { servicos: r?.servicos ?? 0, frota: r?.frota ?? 0, partidas: r?.partidas ?? 0, km: r?.km ?? 0 };
}

/** Linha crua (números, não formatada) — usada direto no Excel e como base pro PDF (via cellForUnidade). */
function buildRawRow(label: string, av: Record<MetricKeyName, number>, pv: Record<MetricKeyName, number>): (string | number)[] {
  const cells: (string | number)[] = [label];
  for (const key of METRIC_KEYS) {
    const a = av[key] ?? 0;
    const p = pv[key] ?? 0;
    const pct = diffPct(a, p);
    cells.push(a, p, p - a, pct == null ? "" : Number(pct.toFixed(1)));
  }
  return cells;
}

function cellForUnidade(v: string | number, i: number): string {
  if (i === 0) return String(v);
  const idx = (i - 1) % 4;
  const metricIdx = Math.floor((i - 1) / 4);
  const m = UNIDADE_REPORT_METRICS[metricIdx];
  if (idx === 3) return fmtPct(v === "" ? null : Number(v));
  if (idx === 2) return fmtDelta(Number(v), m.fmt);
  return m.fmt(Number(v));
}

function buildDisplayRow(label: string, av: Record<MetricKeyName, number>, pv: Record<MetricKeyName, number>): string[] {
  return buildRawRow(label, av, pv).map((v, i) => cellForUnidade(v, i));
}

/**
 * Hora extra PROGRAMADA por linha (ou por grupo de linha, quando `keyOf` é
 * passado): soma dos minutos excedentes ao limite de jornada (DIR 7h / TU
 * 8h24) de cada serviço, alocada na linha (ou grupo) do serviço.
 */
function withHE(
  rows: AggRow[],
  viagens: ViagemLite[],
  linhas: Linha[],
  keyOf?: (linha: string, dia: string) => string,
): AggRow[] {
  const he = new Map<string, number>();
  for (const j of buildJornadas(viagens, linhas)) {
    if (j.incompleto || j.horasExtras <= 0) continue;
    const dia = j.vehicleKey.split("||")[1] ?? "";
    const k = keyOf ? keyOf(j.linha, dia) : j.linha;
    he.set(k, (he.get(k) ?? 0) + j.horasExtras);
  }
  return rows.map((r) => ({ ...r, heMin: he.get(r.groupKey) ?? 0 }));
}

export function ComparativoView() {
  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const kmQ = useQuery({ queryKey: ["km"], queryFn: fetchKm });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const empresaEstacaoQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });

  const viagensRaw = viagensQ.data ?? [];
  const ativos = ativosQ.data ?? [];
  const [somenteAtivos, setSomenteAtivos] = usePersistentState("comparativo.somenteAtivos", false);
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
  const empresaEstacao = empresaEstacaoQ.data ?? [];

  const linhaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l])), [linhas]);
  const empresaOverrideMap = useMemo(() => buildEmpresaOverrideMap(empresaEstacao), [empresaEstacao]);
  const ordemMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l.ordem])), [linhas]);
  const kmMaps = useMemo(() => buildKmMaps(km), [km]);
  const grupoMap = useMemo(() => {
    const m = new Map<string, string>();
    multi.forEach((mu) => m.set(`${mu.linha}|${mu.tipo_dia}`.toLowerCase(), mu.grupo_du));
    return m;
  }, [multi]);

  const opts = useMemo(() => buildOpts(viagens, linhas, multi, empresaEstacao), [viagens, linhas, multi, empresaEstacao]);
  const kmFn = useMemo(() => (v: ViagemLite) => viagemKm(v, kmMaps), [kmMaps]);

  const [atualFilters, setAtualFilters] = useState<Filters>(EMPTY_FILTERS);
  const [propostaFilters, setPropostaFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<{ a: Filters; p: Filters } | null>(null);
  // FLAG: regra de contagem de serviço/frota por linha
  const [criterio, setCriterio] = usePersistentState<CriterioLinha>("comparativo.criterio", "predominancia");
  // FLAG: exibir o comparativo agrupado por Grupo de Linha (soma todas as
  // linhas do grupo, por dia) em vez de detalhado por linha individual.
  const [agruparPorGrupo, setAgruparPorGrupo] = usePersistentState("comparativo.agruparPorGrupo", false);

  // Métricas visíveis (persistida).
  const [visibleMetricsArr, setVisibleMetricsArr] = usePersistentState<string[]>(
    "comparativo.visibleMetrics",
    METRICS.map((m) => m.key as string),
  );
  const visibleMetrics = useMemo(() => new Set(visibleMetricsArr), [visibleMetricsArr]);
  const [showPct, setShowPct] = usePersistentState("comparativo.showPct", true);
  const [onlyDiff, setOnlyDiff] = usePersistentState("comparativo.onlyDiff", false);
  const [repetirSeVazio, setRepetirSeVazio] = usePersistentState("comparativo.repetirSeVazio", false);
  const { params: custoParams } = useSalarioMotorista();
  const herancaQ = useQuery({ queryKey: ["dia-tipo-heranca"], queryFn: fetchDiaTipoHeranca });
  const diaTipoHeranca = useMemo(() => buildDiaTipoHerancaMap(herancaQ.data ?? []), [herancaQ.data]);

  const atualFiltradoBase = useMemo(() => {
    if (!applied) return [] as ViagemLite[];
    return applyFilters(baseFor(applied.a), applied.a, linhaMap, grupoMap, empresaOverrideMap);
  }, [baseFor, applied, linhaMap, grupoMap, empresaOverrideMap]);

  const propostaFiltradoBase = useMemo(() => {
    if (!applied) return [] as ViagemLite[];
    return applyFilters(baseFor(applied.p), applied.p, linhaMap, grupoMap, empresaOverrideMap);
  }, [baseFor, applied, linhaMap, grupoMap, empresaOverrideMap]);

  // Dia tipo "pai" que a Proposta 2 herdou na importação (ex.: "Feriado SG
  // 22-09-26" → "Dias úteis") — é isso que decide de onde vem o que for
  // repetido, não o que está selecionado em "Atual" nesse comparativo
  // (podem ser coisas diferentes).
  const paiDaProposta = applied && applied.p.dia !== "__all" ? diaTipoHeranca.get(applied.p.dia) : undefined;

  // Viagens do dia "pai", respeitando os OUTROS filtros da Proposta 2
  // (empresa, unidade, grupo, linha, etc.) — só troca o dia.
  const paiFiltroSet = useMemo(() => {
    if (!applied || !paiDaProposta) return null;
    return { ...applied.p, dia: paiDaProposta };
  }, [applied, paiDaProposta]);

  const paiViagens = useMemo(() => {
    if (!paiFiltroSet) return [] as ViagemLite[];
    return applyFilters(baseFor(paiFiltroSet), paiFiltroSet, linhaMap, grupoMap, empresaOverrideMap);
  }, [baseFor, paiFiltroSet, linhaMap, grupoMap, empresaOverrideMap]);

  function grupoDaLinha(linha: string, tipoDia: string): string {
    return grupoMap.get(`${linha}|${tipoDia}`.toLowerCase()) ?? `__sem_grupo__${linha}`;
  }

  // Agrupamento pro modo "Agrupar por Grupo de Linha": cada UNIDADE de
  // serviço é alocada à linha dominante (mesma regra do modo por linha) e
  // depois ao Grupo de Linha (grupo_du) dessa linha no dia tipo da própria
  // unidade — soma todas as linhas do grupo, igual ao "Resumo por Linha".
  function groupOfGrupo(u: ServiceUnit) {
    const linha = dominantLinha(u, criterio);
    const key = grupoDaLinha(linha, u.tipo_operacao);
    const label = key.startsWith("__sem_grupo__") ? `(sem grupo) ${linha}` : key;
    const ord = ordemMap.get(linha);
    return { key, label, order: ord == null ? undefined : ord };
  }

  // Decide, por GRUPO DE LINHA (não linha isolada): se o grupo inteiro não
  // teve NENHUMA viagem na Proposta 2 (Feriado), assume que ninguém criou
  // programação especial pra ele e repete o pai inteiro. Se o grupo TEVE
  // alguma viagem na Proposta 2 (mesmo que só em 1 das linhas dele), quem
  // ficou sem dado nesse grupo foi ZERADO DE PROPÓSITO — não repete.
  const { linhasRepetidas, gruposRepetidos } = useMemo(() => {
    if (!repetirSeVazio || !paiFiltroSet || !applied) return { linhasRepetidas: new Set<string>(), gruposRepetidos: new Set<string>() };
    const gruposComDadoNoFilho = new Set<string>();
    for (const v of propostaFiltradoBase) gruposComDadoNoFilho.add(grupoDaLinha(v.linha, applied.p.dia));
    const linhas = new Set<string>();
    const grupos = new Set<string>();
    for (const v of paiViagens) {
      const g = grupoDaLinha(v.linha, paiDaProposta!);
      if (!gruposComDadoNoFilho.has(g)) { linhas.add(v.linha); grupos.add(g); }
    }
    return { linhasRepetidas: linhas, gruposRepetidos: grupos };
  }, [repetirSeVazio, paiFiltroSet, applied, propostaFiltradoBase, paiViagens, paiDaProposta, grupoMap]);

  // Usado nos resumos por Empresa/Grupo/Unidade e no custo — esses somam
  // várias linhas juntas, então preenchemos com as viagens de verdade do
  // pai pras linhas decididas acima.
  const propostaPreenchida = useMemo(() => {
    if (!linhasRepetidas.size) return propostaFiltradoBase;
    const extra = paiViagens.filter((v) => linhasRepetidas.has(v.linha));
    return [...propostaFiltradoBase, ...extra];
  }, [propostaFiltradoBase, paiViagens, linhasRepetidas]);

  // Linhas do pai, agregadas — usado pra "copiar a linha inteira" na
  // tabela principal (evita misturar viagens de linhas diferentes no
  // mesmo cálculo de frota/serviço, que já causou frota errada antes).
  const paiRows = useMemo(() => {
    const chaves = agruparPorGrupo ? gruposRepetidos : linhasRepetidas;
    if (!applied || !chaves.size || !paiFiltroSet) return [] as AggRow[];
    const f = paiViagens;
    const fOrigem = applyFiltersSemLinha(baseFor(paiFiltroSet), paiFiltroSet, linhaMap, grupoMap, empresaOverrideMap);
    const rows = agruparPorGrupo
      ? aggregateByGroup(buildServiceUnits(f, kmFn), groupOfGrupo)
      : aggregateByLinha(buildServiceUnits(f, kmFn), f, ordemMap, fOrigem, criterio);
    return withHE(rows, f, linhas, agruparPorGrupo ? grupoDaLinha : undefined);
  }, [applied, linhasRepetidas, gruposRepetidos, paiFiltroSet, paiViagens, baseFor, linhaMap, grupoMap, kmFn, ordemMap, criterio, linhas, empresaOverrideMap, agruparPorGrupo]);

  const atualRows = useMemo(() => {
    if (!applied) return [] as AggRow[];
    const f = atualFiltradoBase;
    const fOrigem = applyFiltersSemLinha(baseFor(applied.a), applied.a, linhaMap, grupoMap, empresaOverrideMap);
    const rows = agruparPorGrupo
      ? aggregateByGroup(buildServiceUnits(f, kmFn), groupOfGrupo)
      : aggregateByLinha(buildServiceUnits(f, kmFn), f, ordemMap, fOrigem, criterio);
    return withHE(rows, f, linhas, agruparPorGrupo ? grupoDaLinha : undefined);
  }, [baseFor, applied, linhaMap, grupoMap, kmFn, ordemMap, criterio, linhas, empresaOverrideMap, atualFiltradoBase, agruparPorGrupo]);

  const propostaRows = useMemo(() => {
    if (!applied) return [] as AggRow[];
    const f = propostaFiltradoBase;
    const fOrigem = applyFiltersSemLinha(baseFor(applied.p), applied.p, linhaMap, grupoMap, empresaOverrideMap);
    const rows = agruparPorGrupo
      ? aggregateByGroup(buildServiceUnits(f, kmFn), groupOfGrupo)
      : aggregateByLinha(buildServiceUnits(f, kmFn), f, ordemMap, fOrigem, criterio);
    return withHE(rows, f, linhas, agruparPorGrupo ? grupoDaLinha : undefined);
  }, [baseFor, applied, linhaMap, grupoMap, kmFn, ordemMap, criterio, linhas, empresaOverrideMap, propostaFiltradoBase, agruparPorGrupo]);


  const basesAplicadas = useMemo(() => {
    if (!applied) return { atual: [] as ViagemLite[], proposta: [] as ViagemLite[] };
    return {
      atual: atualFiltradoBase,
      proposta: propostaPreenchida,
    };
  }, [applied, atualFiltradoBase, propostaPreenchida]);


  const totalFrotaUnica = useMemo(() => ({
    a: new Set(Array.from(buildServiceUnits(basesAplicadas.atual, kmFn).values()).map((u) => u.vehicleKey)).size,
    p: new Set(Array.from(buildServiceUnits(basesAplicadas.proposta, kmFn).values()).map((u) => u.vehicleKey)).size,
  }), [basesAplicadas, kmFn]);

  const kmSemCadastro = useMemo(() => ({
    atual: basesAplicadas.atual.filter((v) => viagemKmResult(v, kmMaps).fonte === "sem_cadastro").length,
    proposta: basesAplicadas.proposta.filter((v) => viagemKmResult(v, kmMaps).fonte === "sem_cadastro").length,
  }), [basesAplicadas, kmMaps]);

  // Resumo Gerencial (Atual x Proposta) por Empresa / Grupo de Linha / Unidade
  function buildBreakdown(
    viagens: ViagemLite[],
    chaveViagem: (v: ViagemLite) => string,
    chaveUnit: (u: ServiceUnit) => string,
    chaveJornada: (j: ReturnType<typeof buildJornadas>[number]) => string,
  ) {
    const units = buildServiceUnits(viagens, kmFn);
    const m = new Map<string, { partidas: number; km: number; servicos: Set<string>; veiculos: Set<string> }>();
    for (const u of units.values()) {
      const k = chaveUnit(u);
      if (!m.has(k)) m.set(k, { partidas: 0, km: 0, servicos: new Set(), veiculos: new Set() });
      m.get(k)!.servicos.add(u.key);
      m.get(k)!.veiculos.add(u.vehicleKey);
    }
    for (const v of viagens) {
      const k = chaveViagem(v);
      if (!m.has(k)) m.set(k, { partidas: 0, km: 0, servicos: new Set(), veiculos: new Set() });
      if ((v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL" && v.partida) m.get(k)!.partidas += 1;
      m.get(k)!.km += kmFn(v);
    }
    const custoPorChave = new Map<string, number>();
    if (custoParams) {
      const jornadas = buildJornadas(viagens, linhas);
      for (const j of jornadas) {
        const k = chaveJornada(j);
        custoPorChave.set(k, (custoPorChave.get(k) ?? 0) + custoServico(j, custoParams));
      }
    }
    const out = new Map<string, BreakdownVal>();
    for (const [k, x] of m) out.set(k, { servicos: x.servicos.size, frota: x.veiculos.size, partidas: x.partidas, km: x.km, custo: custoPorChave.get(k) ?? 0 });
    return out;
  }

  function mergeBreakdown(a: Map<string, BreakdownVal>, p: Map<string, BreakdownVal>) {
    const chaves = new Set([...a.keys(), ...p.keys()]);
    const zero: BreakdownVal = { servicos: 0, frota: 0, partidas: 0, km: 0, custo: 0 };
    return Array.from(chaves, (chave) => ({
      chave, atual: a.get(chave) ?? zero, proposta: p.get(chave) ?? zero,
    })).sort((x, y) => x.chave.localeCompare(y.chave));
  }

  const resumoPorEmpresa = useMemo(() => {
    if (!applied) return [];
    const empA = buildEmpresaPorServico(basesAplicadas.atual, linhaMap, empresaOverrideMap);
    const empP = buildEmpresaPorServico(basesAplicadas.proposta, linhaMap, empresaOverrideMap);
    const chaveJ = (j: ReturnType<typeof buildJornadas>[number], mapa: Map<string, string>) => mapa.get(j.vehicleKey) || linhaMap.get(j.linha)?.empresa || "Sem empresa";
    const a = buildBreakdown(basesAplicadas.atual, (v) => resolveEmpresaViagem(v, linhaMap, empresaOverrideMap) || "Sem empresa", (u) => empA.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, criterio))?.empresa || "Sem empresa", (j) => chaveJ(j, empA));
    const p = buildBreakdown(basesAplicadas.proposta, (v) => resolveEmpresaViagem(v, linhaMap, empresaOverrideMap) || "Sem empresa", (u) => empP.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, criterio))?.empresa || "Sem empresa", (j) => chaveJ(j, empP));
    return mergeBreakdown(a, p);
  }, [applied, basesAplicadas, linhaMap, empresaOverrideMap, criterio, kmFn, linhas, custoParams]);

  const resumoPorUnidade = useMemo(() => {
    if (!applied) return [];
    const uniA = buildUnidadePorServico(basesAplicadas.atual, linhaMap, empresaOverrideMap);
    const uniP = buildUnidadePorServico(basesAplicadas.proposta, linhaMap, empresaOverrideMap);
    const chaveJ = (j: ReturnType<typeof buildJornadas>[number], mapa: Map<string, string>) => mapa.get(j.vehicleKey) || linhaMap.get(j.linha)?.unidade || "Sem unidade";
    const a = buildBreakdown(basesAplicadas.atual, (v) => resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) || "Sem unidade", (u) => uniA.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, criterio))?.unidade || "Sem unidade", (j) => chaveJ(j, uniA));
    const p = buildBreakdown(basesAplicadas.proposta, (v) => resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) || "Sem unidade", (u) => uniP.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, criterio))?.unidade || "Sem unidade", (j) => chaveJ(j, uniP));
    return mergeBreakdown(a, p);
  }, [applied, basesAplicadas, linhaMap, empresaOverrideMap, criterio, kmFn, linhas, custoParams]);

  const resumoPorGrupo = useMemo(() => {
    if (!applied) return [];
    const grpA = buildGrupoPorServico(basesAplicadas.atual, linhaMap, empresaOverrideMap);
    const grpP = buildGrupoPorServico(basesAplicadas.proposta, linhaMap, empresaOverrideMap);
    const chaveJ = (j: ReturnType<typeof buildJornadas>[number], mapa: Map<string, string>) => mapa.get(j.vehicleKey) || linhaMap.get(j.linha)?.ordem || "Sem grupo";
    const a = buildBreakdown(basesAplicadas.atual, (v) => resolveGrupoViagem(v, linhaMap, empresaOverrideMap) || "Sem grupo", (u) => grpA.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, criterio))?.ordem || "Sem grupo", (j) => chaveJ(j, grpA));
    const p = buildBreakdown(basesAplicadas.proposta, (v) => resolveGrupoViagem(v, linhaMap, empresaOverrideMap) || "Sem grupo", (u) => grpP.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, criterio))?.ordem || "Sem grupo", (j) => chaveJ(j, grpP));
    return mergeBreakdown(a, p);
  }, [applied, basesAplicadas, linhaMap, empresaOverrideMap, criterio, kmFn, linhas, custoParams]);

  const [ordenarPor, setOrdenarPor] = usePersistentState<"padrao" | "unidade">("comparativo.ordenarPor", "padrao");

  // Unidade por linha (com exceção por estação), pra ordenar por unidade —
  // tally de maioria a partir das viagens de ambos os cenários.
  const unidadePorLinha = useMemo(() => {
    const tally = new Map<string, Map<string, number>>();
    for (const v of [...basesAplicadas.atual, ...basesAplicadas.proposta]) {
      const un = resolveUnidadeViagem(v, linhaMap, empresaOverrideMap);
      if (!un) continue;
      const m = tally.get(v.linha) ?? new Map<string, number>();
      m.set(un, (m.get(un) ?? 0) + 1);
      tally.set(v.linha, m);
    }
    const out = new Map<string, string>();
    for (const [key, m] of tally) {
      let best: string | null = null, bestN = -1;
      for (const [un, n] of m) if (n > bestN) { best = un; bestN = n; }
      if (best) out.set(key, best);
    }
    return out;
  }, [basesAplicadas, linhaMap, empresaOverrideMap]);

  // Custo por linha (Atual x Proposta) pra tabela principal — aqui sempre é
  // por linha, então a chave é direto j.linha, sem precisar do mapeamento
  // mais complexo usado nos resumos por Empresa/Grupo/Unidade.
  const custoPorLinha = useMemo(() => {
    const atual = new Map<string, number>();
    const proposta = new Map<string, number>();
    // Precisa bater com o `linha` exibido na tabela (groupLabel), não com o
    // groupKey cru — "sem grupo" vira "(sem grupo) X" no rótulo exibido.
    const chave = (j: { linha: string; vehicleKey: string }) => {
      if (!agruparPorGrupo) return j.linha;
      const raw = grupoDaLinha(j.linha, j.vehicleKey.split("||")[1] ?? "");
      return raw.startsWith("__sem_grupo__") ? `(sem grupo) ${j.linha}` : raw;
    };
    if (custoParams) {
      for (const j of buildJornadas(basesAplicadas.atual, linhas)) { const k = chave(j); atual.set(k, (atual.get(k) ?? 0) + custoServico(j, custoParams)); }
      for (const j of buildJornadas(basesAplicadas.proposta, linhas)) { const k = chave(j); proposta.set(k, (proposta.get(k) ?? 0) + custoServico(j, custoParams)); }
    }
    return { atual, proposta };
  }, [basesAplicadas, linhas, custoParams, agruparPorGrupo]);

  // Em modo "por linha", a chave de repetição é a linha; em modo "por grupo
  // de linha", é o grupo inteiro (gruposRepetidos já é calculado acima pela
  // mesma regra: grupo sem NENHUM dado na Proposta 2 repete o pai).
  const chavesRepetidas = agruparPorGrupo ? gruposRepetidos : linhasRepetidas;

  const merged = useMemo(() => {
    const map = new Map<string, { linha: string; order: string; a: AggRow | null; p: AggRow | null }>();
    for (const r of atualRows) {
      map.set(r.groupKey, { linha: r.groupLabel, order: r.groupOrder, a: r, p: null });
    }
    for (const r of propostaRows) {
      const cur = map.get(r.groupKey);
      if (cur) cur.p = r;
      else map.set(r.groupKey, { linha: r.groupLabel, order: r.groupOrder, a: null, p: r });
    }
    // Linha (ou grupo) decidida pra "repetir" (sem dado na Proposta 2): usa
    // o cálculo a partir do PAI registrado na importação (não da seleção de
    // "Atual" na tela, que pode ser outra coisa) — evita misturar viagens de
    // linhas diferentes no mesmo cálculo de frota/serviço (o que já causou
    // frota errada antes).
    const paiPorChave = new Map(paiRows.map((r) => [r.groupKey, r]));
    for (const chave of chavesRepetidas) {
      const paiRow = paiPorChave.get(chave);
      if (!paiRow) continue;
      const cur = map.get(chave);
      if (cur) cur.p = paiRow;
      else map.set(chave, { linha: paiRow.groupLabel, order: paiRow.groupOrder, a: null, p: paiRow });
    }
    let arr = Array.from(map.values()).sort((a, b) => {
      if (ordenarPor === "unidade") {
        const ua = unidadePorLinha.get(a.linha) ?? "";
        const ub = unidadePorLinha.get(b.linha) ?? "";
        if (ua !== ub) return ua.localeCompare(ub, "pt-BR");
      }
      if (a.order !== b.order) return a.order.localeCompare(b.order, "pt-BR", { numeric: true, sensitivity: "base" });
      return a.linha.localeCompare(b.linha);
    });
    if (onlyDiff) {
      arr = arr.filter(({ a, p }) =>
        METRICS.some((m) => (a?.[m.key] as number ?? 0) !== (p?.[m.key] as number ?? 0)),
      );
    }
    return arr;
  }, [atualRows, propostaRows, onlyDiff, ordenarPor, unidadePorLinha, chavesRepetidas, paiRows]);

  const totals = useMemo(() => {
    const base = { a: {} as Record<string, number>, p: {} as Record<string, number> };
    for (const m of METRICS) { base.a[m.key as string] = 0; base.p[m.key as string] = 0; }
    for (const { a, p } of merged) {
      for (const m of METRICS) {
        base.a[m.key as string] += (a?.[m.key] as number) ?? 0;
        base.p[m.key as string] += (p?.[m.key] as number) ?? 0;
      }
    }
    base.a.frota = totalFrotaUnica.a;
    base.p.frota = totalFrotaUnica.p;
    return base;
  }, [merged, totalFrotaUnica]);

  const shownMetrics = METRICS.filter((m) => visibleMetrics.has(m.key as string));
  const colsPerMetric = showPct ? 4 : 3;
  const totalCols = 1 + shownMetrics.length * colsPerMetric;
  const mostrarCustoTabela = visibleMetrics.has("custo") && !!custoParams && custoParams.salarioMotoristaMensal > 0;

  function toggleMetric(k: string) {
    const next = new Set(visibleMetrics);
    if (next.has(k)) next.delete(k); else next.add(k);
    setVisibleMetricsArr(Array.from(next));
  }

  const loading = viagensQ.isLoading || linhasQ.isLoading || kmQ.isLoading || multiQ.isLoading;

  // Linhas do comparativo (merged) agrupadas por Unidade — mesma lógica de
  // maioria já usada em unidadePorLinha (ordenar por Unidade). Só faz
  // sentido no modo "por linha" (agruparPorGrupo=false): em modo "por
  // grupo" as linhas de merged já são grupos de linha, não linhas soltas.
  const unidadeBlocks = useMemo(() => {
    const map = new Map<string, { linha: string; a: AggRow | null; p: AggRow | null }[]>();
    for (const row of merged) {
      const un = unidadePorLinha.get(row.linha) ?? "Sem unidade";
      if (!map.has(un)) map.set(un, []);
      map.get(un)!.push(row);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([unidade, rows]) => ({ unidade, rows }));
  }, [merged, unidadePorLinha]);

  // Total de uma Unidade: reaproveita resumoPorUnidade (já dedupa frota por
  // veículo distinto, diferente de somar o campo frota linha a linha). Cai
  // pra soma simples só se por algum motivo a chave não existir lá.
  function totalDaUnidade(unidade: string, rows: { a: AggRow | null; p: AggRow | null }[]): { atual: BreakdownVal; proposta: BreakdownVal } {
    const found = resumoPorUnidade.find((r) => r.chave === unidade);
    if (found) return found;
    const zero: BreakdownVal = { servicos: 0, frota: 0, partidas: 0, km: 0, custo: 0 };
    const soma = (lado: "a" | "p") => rows.reduce((s, r) => {
      const row = r[lado];
      return { servicos: s.servicos + (row?.totalServico ?? 0), frota: s.frota + (row?.frota ?? 0), partidas: s.partidas + (row?.partidas ?? 0), km: s.km + (row?.km ?? 0), custo: 0 };
    }, zero);
    return { atual: soma("a"), proposta: soma("p") };
  }

  const resumoUnidadeTotal = useMemo(() => {
    const zero: BreakdownVal = { servicos: 0, frota: 0, partidas: 0, km: 0, custo: 0 };
    const soma = (lado: "atual" | "proposta") => resumoPorUnidade.reduce((s, r) => ({
      servicos: s.servicos + r[lado].servicos, frota: s.frota + r[lado].frota, partidas: s.partidas + r[lado].partidas, km: s.km + r[lado].km, custo: s.custo + r[lado].custo,
    }), zero);
    return { atual: soma("atual"), proposta: soma("proposta") };
  }, [resumoPorUnidade]);

  function tituloComparativo(): string {
    const label = applied && applied.p.dia !== "__all" ? applied.p.dia : "PROPOSTA";
    const data = new Date().toLocaleDateString("pt-BR");
    return `RELATÓRIO COMPARATIVO — ATUAL vs ${label.toUpperCase()} ${data}`;
  }

  function buildExportRows() {
    const header1: string[] = [agruparPorGrupo ? "Grupo de Linha" : "Linha"];
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

  function exportXLSXFlat() {
    const { header1, header2, body, tot } = buildExportRows();
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [
      ["RELATÓRIO COMPARATIVO — ATUAL vs PROPOSTA"],
      [`Gerado em ${new Date().toLocaleString("pt-BR")} — ${merged.length} ${agruparPorGrupo ? "grupo(s)" : "linha(s)"}`],
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

  // Excel "por Unidade": um bloco por Unidade (título, sub-cabeçalho
  // mesclado, cabeçalho azul, linhas, total azul claro) + resumo final por
  // Unidade — mesmo layout do PDF novo. Usa xlsx-js-style pra cor de célula.
  function exportXLSXPorUnidade() {
    type RowKind = "title" | "subtitle" | "blank" | "unidade" | "subheader" | "header" | "body" | "total" | "resumoBody" | "resumoTotal";
    const rows: (string | number)[][] = [];
    const kinds: RowKind[] = [];
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    const push = (r: (string | number)[], k: RowKind) => { rows.push(r); kinds.push(k); };
    const addSubheaderMerges = (r: number) => {
      let c = 1;
      for (let i = 0; i < UNIDADE_REPORT_METRICS.length; i++) {
        merges.push({ s: { r, c }, e: { r, c: c + 3 } });
        c += 4;
      }
    };

    push([tituloComparativo()], "title");
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: UNIDADE_TOTAL_COLS - 1 } });
    push([`Gerado em ${new Date().toLocaleString("pt-BR")} — ${merged.length} linha(s)`], "subtitle");
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: UNIDADE_TOTAL_COLS - 1 } });
    push([], "blank");

    for (const block of unidadeBlocks) {
      push([block.unidade], "unidade");
      merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: UNIDADE_TOTAL_COLS - 1 } });
      push(UNIDADE_SUBHEADER_ROW, "subheader");
      addSubheaderMerges(rows.length - 1);
      push(UNIDADE_REAL_HEADER_ROW, "header");
      for (const r of block.rows) push(buildRawRow(r.linha, fromAgg(r.a), fromAgg(r.p)), "body");
      const tot = totalDaUnidade(block.unidade, block.rows);
      push(buildRawRow("TOTAL", fromBreakdown(tot.atual), fromBreakdown(tot.proposta)), "total");
      push([], "blank");
    }

    push(["RESUMO POR UNIDADE"], "unidade");
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: UNIDADE_TOTAL_COLS - 1 } });
    push(UNIDADE_SUBHEADER_ROW, "subheader");
    addSubheaderMerges(rows.length - 1);
    push(["Unidade", ...UNIDADE_REAL_HEADER_ROW.slice(1)], "header");
    for (const r of resumoPorUnidade) push(buildRawRow(r.chave, fromBreakdown(r.atual), fromBreakdown(r.proposta)), "resumoBody");
    push(buildRawRow("TOTAL GERAL", fromBreakdown(resumoUnidadeTotal.atual), fromBreakdown(resumoUnidadeTotal.proposta)), "resumoTotal");

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!merges"] = merges;
    ws["!cols"] = Array.from({ length: UNIDADE_TOTAL_COLS }, (_, i) => ({ wch: i === 0 ? 22 : 11 }));

    const FILL_BLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE } };
    const FILL_LIGHTBLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE_LIGHT } };
    const THIN = { style: "thin", color: { rgb: "B4B4B4" } };
    const border = { top: THIN, bottom: THIN, left: THIN, right: THIN };

    rows.forEach((row, r) => {
      const kind = kinds[r];
      if (kind === "blank") return;
      for (let c = 0; c < UNIDADE_TOTAL_COLS; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = (ws as any)[addr];
        if (!cell) continue;
        if (kind === "title") cell.s = { font: { bold: true, sz: 13, color: { rgb: XLSX_LINE_BLUE } }, alignment: { horizontal: "center" } };
        else if (kind === "subtitle") cell.s = { font: { sz: 9, color: { rgb: "666666" } }, alignment: { horizontal: "center" } };
        else if (kind === "unidade") cell.s = { font: { bold: true, sz: 11 }, alignment: { horizontal: "left" } };
        else if (kind === "subheader") cell.s = { font: { bold: true }, alignment: { horizontal: "center" } };
        else if (kind === "header") cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: FILL_BLUE, alignment: { horizontal: c === 0 ? "left" : "center" }, border };
        else if (kind === "body" || kind === "resumoBody") cell.s = { font: c === 0 ? { bold: true, color: { rgb: XLSX_LINE_BLUE } } : { color: { rgb: "000000" } }, alignment: { horizontal: c === 0 ? "left" : "right" }, border };
        else if (kind === "total" || kind === "resumoTotal") cell.s = { font: { bold: true, color: { rgb: "000000" } }, fill: FILL_LIGHTBLUE, alignment: { horizontal: c === 0 ? "left" : "right" }, border };
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comparativo");
    XLSX.writeFile(wb, `relatorio_comparativo_${new Date().toISOString().slice(0, 10)}.xlsx`);
    void logAudit({ action: "export", entity: "relatorio_comparativo", details: { format: "xlsx", rows: merged.length, layout: "por_unidade" } });
  }

  function exportXLSX() {
    if (agruparPorGrupo) exportXLSXFlat();
    else exportXLSXPorUnidade();
  }

  function buildPDFFlat(orientation: PdfOrientation) {
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
        // "->" em vez de "→": a fonte padrão do jsPDF (Helvetica/WinAnsi) não
        // tem o caractere de seta Unicode — vira "mojibake" no PDF gerado.
        ? `Atual: ${periodoTxt(applied.a)}  ->  Proposta: ${periodoTxt(applied.p)} — ${merged.length} ${agruparPorGrupo ? "grupo(s)" : "linha(s)"}`
        : `${merged.length} ${agruparPorGrupo ? "grupo(s)" : "linha(s)"} — mesma base do Resumo por Linha`;

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

  // PDF "por Unidade": um bloco (autoTable) por Unidade — nome em negrito,
  // sub-cabeçalho mesclado (Serviços/Frota/Partidas/KM), cabeçalho azul,
  // linhas da Unidade, total em azul claro — seguido do resumo final por
  // Unidade. `pageBreak: "avoid"` tenta manter cada Unidade inteira numa
  // página só; se não couber nem numa página em branco, ela pagina
  // normalmente (repetindo o cabeçalho), o que é aceitável pro caso de
  // Unidades com muitas linhas.
  function buildPDFPorUnidade(orientation: PdfOrientation) {
    const titleTxt = tituloComparativo();
    const probe = new jsPDF({ orientation, unit: "mm", format: "a4" });
    const pageW = probe.internal.pageSize.getWidth();
    const pageH = probe.internal.pageSize.getHeight();
    const HEADER_H = 16;
    // -3mm de folga: a medição de largura via getTextWidth fica levemente
    // abaixo do que o autoTable calcula internamente (padding/fonte), e sem
    // essa folga a última coluna estourava por ~2mm.
    const usableW = pageW - 16 - 3;

    const periodoTxt = (f: Filters) => [
      f.dia !== "__all" ? f.dia : "Todos os dias",
      f.versao !== "__all" ? `Versão ${f.versao}` : null,
    ].filter(Boolean).join(" · ");
    const subtitleTxt = applied
      ? `Atual: ${periodoTxt(applied.a)}  ->  Proposta: ${periodoTxt(applied.p)} — ${merged.length} linha(s) em ${unidadeBlocks.length} unidade(s)`
      : `${merged.length} linha(s)`;

    function drawHeader(d: InstanceType<typeof jsPDF>) {
      d.setTextColor(...PDF_LINE_BLUE); d.setFont("helvetica", "bold"); d.setFontSize(11);
      d.text(titleTxt, 10, 8);
      d.setFont("helvetica", "normal"); d.setFontSize(7); d.setTextColor(100);
      d.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, pageW - 10, 8, { align: "right" });
      d.setFontSize(6.8); d.setTextColor(90);
      d.text(subtitleTxt, 10, 13);
      d.setDrawColor(...PDF_LINE_BLUE); d.setLineWidth(0.5);
      d.line(10, 15, pageW - 10, 15);
      d.setTextColor(20);
    }

    // Junta todas as linhas de exibição (cabeçalho real + corpo/total de
    // cada bloco + resumo) pra medir a largura natural de cada uma das 17
    // colunas de uma vez só — garante que todo bloco use a MESMA largura.
    const allDisplayRows: string[][] = [UNIDADE_REAL_HEADER_ROW_PDF];
    for (const block of unidadeBlocks) {
      for (const r of block.rows) allDisplayRows.push(buildDisplayRow(r.linha, fromAgg(r.a), fromAgg(r.p)));
      const tot = totalDaUnidade(block.unidade, block.rows);
      allDisplayRows.push(buildDisplayRow("TOTAL", fromBreakdown(tot.atual), fromBreakdown(tot.proposta)));
    }
    for (const r of resumoPorUnidade) allDisplayRows.push(buildDisplayRow(r.chave, fromBreakdown(r.atual), fromBreakdown(r.proposta)));
    allDisplayRows.push(buildDisplayRow("TOTAL GERAL", fromBreakdown(resumoUnidadeTotal.atual), fromBreakdown(resumoUnidadeTotal.proposta)));

    function naturalColWidths(fontSize: number): number[] {
      const padX = 1.4;
      probe.setFontSize(fontSize);
      // Sempre mede em negrito: cabeçalho e linha de total são bold em toda
      // coluna, e a coluna 0 do corpo também — medir em fonte normal
      // subestimava a largura e o texto quebrava linha (ex.: "Proposta").
      probe.setFont("helvetica", "bold");
      const widths = new Array(UNIDADE_TOTAL_COLS).fill(0);
      for (const row of allDisplayRows) {
        for (let c = 0; c < UNIDADE_TOTAL_COLS; c++) {
          const w = probe.getTextWidth(String(row[c] ?? ""));
          if (w > widths[c]) widths[c] = w;
        }
      }
      return widths.map((w) => w + padX * 2);
    }

    const baseWidths = naturalColWidths(6.5);
    const baseTotal = baseWidths.reduce((s, w) => s + w, 0);
    // Só ajusta a largura (não a altura — o relatório pode ocupar quantas
    // páginas precisar); piso de zoom garante um tamanho de fonte mínimo
    // legível mesmo se o conteúdo não couber de jeito nenhum.
    const zoom = Math.max(0.85, Math.min(1.3, usableW / baseTotal));
    const fontSize = 6.5 * zoom;
    const widths = baseWidths.map((w) => w * zoom);
    const scaledTotal = widths.reduce((s, w) => s + w, 0);
    // Centraliza de verdade: a margem direita passada pra autoTable precisa
    // bater com a esquerda, senão a largura disponível real fica menor que
    // scaledTotal e a última coluna estoura por alguns milímetros.
    const marginLeft = Math.max(5, (pageW - scaledTotal) / 2);
    const marginRight = Math.max(5, pageW - scaledTotal - marginLeft);

    const columnStyles: Record<number, { cellWidth: number; halign: "left" | "right" }> = {};
    widths.forEach((w, i) => { columnStyles[i] = { cellWidth: w, halign: i === 0 ? "left" : "right" }; });

    const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
    drawHeader(doc);
    let currentY = HEADER_H + 3;

    function drawBlock(nome: string, linhaRows: string[][], totalRow: string[], firstColLabel = "Linha") {
      const nameHeadRow = [{ content: nome, colSpan: UNIDADE_TOTAL_COLS, styles: { halign: "left" as const, fontStyle: "bold" as const, fillColor: [255, 255, 255] as [number, number, number], textColor: [20, 20, 20] as [number, number, number] } }];
      const subHeadRow = [
        { content: "", styles: { fillColor: [255, 255, 255] as [number, number, number] } },
        ...UNIDADE_REPORT_METRICS.map((m) => ({ content: m.label, colSpan: 4, styles: { halign: "center" as const, fontStyle: "bold" as const, fillColor: [255, 255, 255] as [number, number, number], textColor: [20, 20, 20] as [number, number, number] } })),
      ];
      const headerLabels = [firstColLabel, ...UNIDADE_REAL_HEADER_ROW_PDF.slice(1)];
      const realHeadRow = headerLabels.map((label, i) => ({ content: label, styles: { fillColor: PDF_BLUE, textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const, halign: (i === 0 ? "left" : "center") as "left" | "center" } }));

      autoTable(doc, {
        startY: currentY,
        head: [nameHeadRow, subHeadRow, realHeadRow],
        body: linhaRows,
        foot: [totalRow],
        styles: { fontSize, cellPadding: 1.2 * zoom, valign: "middle", halign: "right", lineColor: [180, 180, 180], lineWidth: 0.18 },
        columnStyles,
        footStyles: { fillColor: PDF_BLUE_LIGHT, textColor: [0, 0, 0], fontStyle: "bold" },
        margin: { left: marginLeft, right: marginRight, top: HEADER_H + 3, bottom: 12 },
        theme: "grid",
        tableWidth: "wrap",
        showFoot: "lastPage",
        pageBreak: "avoid",
        rowPageBreak: "avoid",
        didDrawPage: () => drawHeader(doc),
        // Coluna "Linha" em azul/negrito só no CORPO (não no total, que já é
        // preto/negrito via footStyles) — columnStyles não distingue seção.
        didParseCell: (data: any) => {
          if (data.section === "body" && data.column.index === 0) {
            data.cell.styles.textColor = PDF_LINE_BLUE;
            data.cell.styles.fontStyle = "bold";
          }
        },
      });
      currentY = (doc as any).lastAutoTable.finalY + 4;
    }

    for (const block of unidadeBlocks) {
      const tot = totalDaUnidade(block.unidade, block.rows);
      drawBlock(
        block.unidade,
        block.rows.map((r) => buildDisplayRow(r.linha, fromAgg(r.a), fromAgg(r.p))),
        buildDisplayRow("TOTAL", fromBreakdown(tot.atual), fromBreakdown(tot.proposta)),
      );
    }

    if (resumoPorUnidade.length) {
      drawBlock(
        "RESUMO POR UNIDADE",
        resumoPorUnidade.map((r) => buildDisplayRow(r.chave, fromBreakdown(r.atual), fromBreakdown(r.proposta))),
        buildDisplayRow("TOTAL GERAL", fromBreakdown(resumoUnidadeTotal.atual), fromBreakdown(resumoUnidadeTotal.proposta)),
        "Unidade",
      );
    }

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(7); doc.setTextColor(120);
      doc.text(`Página ${i} de ${pages}`, pageW - 10, pageH - 5, { align: "right" });
    }
    return doc;
  }

  function buildPDF(orientation: PdfOrientation) {
    return agruparPorGrupo ? buildPDFFlat(orientation) : buildPDFPorUnidade(orientation);
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
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="Em vez de detalhar linha por linha, soma todas as linhas de cada Grupo de Linha (grupo_du) e mostra o comparativo por grupo.">
            <Checkbox checked={agruparPorGrupo} onCheckedChange={(v) => setAgruparPorGrupo(!!v)} className="h-3.5 w-3.5" />
            Agrupar por Grupo de Linha
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
            defaultOrientation={agruparPorGrupo ? "landscape" : "portrait"}
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
          Gerado em {new Date().toLocaleString("pt-BR")} — {merged.length} {agruparPorGrupo ? "grupo(s)" : "linha(s)"}
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
          {custoParams && custoParams.salarioMotoristaMensal > 0 && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox
                checked={visibleMetrics.has("custo")}
                onCheckedChange={() => toggleMetric("custo")}
                className="h-3.5 w-3.5"
              />
              Custo M.O.
            </label>
          )}
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={showPct} onCheckedChange={(v) => setShowPct(!!v)} className="h-3.5 w-3.5" />
              Mostrar Δ%
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={onlyDiff} onCheckedChange={(v) => setOnlyDiff(!!v)} className="h-3.5 w-3.5" />
              Somente com diferença
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={repetirSeVazio} onCheckedChange={(v) => setRepetirSeVazio(!!v)} className="h-3.5 w-3.5" />
              Repetir Proposta 1 nas linhas sem dado na Proposta 2
            </label>
          </div>
        </CardContent>
      </Card>

      {applied && repetirSeVazio && applied.p.dia !== "__all" && !paiDaProposta && (
        <Card className="shadow-[var(--shadow-card)] border-amber-500/30">
          <CardContent className="p-3 text-xs text-amber-700">
            O dia tipo "{applied.p.dia}" da Proposta 2 não tem um dia "pai" registrado (Dias úteis/Sábado/Domingo) —
            isso é definido na hora da importação, quando o sistema pergunta de qual dia tipo herdar o comportamento.
            Sem essa associação, não dá pra saber o que repetir, então nada foi preenchido.
          </CardContent>
        </Card>
      )}

      {applied && repetirSeVazio && paiDaProposta && (
        <Card className="shadow-[var(--shadow-card)] border-amber-500/30">
          <CardContent className="p-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">
              {linhasRepetidas.size > 0
                ? `${linhasRepetidas.size} linha(s) repetindo "${paiDaProposta}" (grupo de linha sem nenhum dado na Proposta 2)`
                : `Nenhuma linha precisou repetir "${paiDaProposta}" — todo grupo de linha teve algum dado na Proposta 2`}
            </p>
            <p className="text-[11px] text-muted-foreground mb-2">
              Decidido automaticamente pelo <strong>Grupo de Linha</strong>: se o grupo inteiro (ex.: 07 + 07A) não teve
              nenhuma viagem na Proposta 2, repete "{paiDaProposta}" pra ele. Se o grupo teve alguma viagem (em qualquer
              linha dele), assume que foi decisão de propósito e não repete o resto — mesmo que fique zerado.
            </p>
            {linhasRepetidas.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(linhasRepetidas).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })).map((l) => (
                  <Badge key={l} variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-amber-500/10 text-amber-700 border-amber-500/30">{l}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {applied && (kmSemCadastro.atual > 0 || kmSemCadastro.proposta > 0) && (
        <div className="w-full rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2">
          <span className="text-xs">Trechos sem KM cadastrado entram como 0 km — Atual: <strong>{kmSemCadastro.atual}</strong> viagem(ns); Proposta: <strong>{kmSemCadastro.proposta}</strong> viagem(ns).</span>
        </div>
      )}

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4" />
            Comparativo por {agruparPorGrupo ? "Grupo de Linha" : "Linha"}
            <Badge variant="outline" className="text-[10px]">{merged.length} {agruparPorGrupo ? "grupo(s)" : "linha(s)"}</Badge>
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
                    <TableHead rowSpan={2} className="px-2 py-1 align-bottom">{agruparPorGrupo ? "Grupo de Linha" : "Linha"}</TableHead>
                    {shownMetrics.map((m) => (
                      <TableHead
                        key={m.key as string}
                        colSpan={colsPerMetric}
                        className="px-2 py-1 text-center border-l"
                      >
                        {m.label}
                      </TableHead>
                    ))}
                    {mostrarCustoTabela && (
                      <TableHead colSpan={colsPerMetric} className="px-2 py-1 text-center border-l">Custo M.O.</TableHead>
                    )}
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
                    {mostrarCustoTabela && (
                      <Fragment>
                        <TableHead className="px-2 py-1 text-right border-l text-[10px] uppercase tracking-wider text-blue-600">Atual</TableHead>
                        <TableHead className="px-2 py-1 text-right text-[10px] uppercase tracking-wider text-emerald-600">Prop.</TableHead>
                        <TableHead className="px-2 py-1 text-right text-[10px] uppercase tracking-wider">Δ</TableHead>
                        {showPct && <TableHead className="px-2 py-1 text-right text-[10px] uppercase tracking-wider">Δ%</TableHead>}
                      </Fragment>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {merged.map(({ linha, a, p }) => (
                    <TableRow key={linha} className="h-8">
                      <TableCell className="px-2 py-1 font-medium">
                        {linha}
                        {chavesRepetidas.has(linha) && (
                          <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0 h-4 align-middle bg-amber-500/10 text-amber-700 border-amber-500/30">repetido</Badge>
                        )}
                      </TableCell>
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
                      {mostrarCustoTabela && (() => {
                        const av = custoPorLinha.atual.get(linha) ?? 0;
                        const pv = custoPorLinha.proposta.get(linha) ?? 0;
                        const d = pv - av;
                        const pct = diffPct(av, pv);
                        const dCls = d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "text-muted-foreground";
                        return (
                          <Fragment>
                            <TableCell className="px-2 py-1 text-right tabular-nums border-l">{fmtMoeda(av)}</TableCell>
                            <TableCell className="px-2 py-1 text-right tabular-nums">{fmtMoeda(pv)}</TableCell>
                            <TableCell className={`px-2 py-1 text-right tabular-nums font-semibold ${dCls}`}>{d >= 0 ? "+" : ""}{fmtMoeda(d)}</TableCell>
                            {showPct && <TableCell className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{fmtPct(pct)}</TableCell>}
                          </Fragment>
                        );
                      })()}
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
                    {mostrarCustoTabela && (() => {
                      const av = Array.from(custoPorLinha.atual.values()).reduce((s, v) => s + v, 0);
                      const pv = Array.from(custoPorLinha.proposta.values()).reduce((s, v) => s + v, 0);
                      const d = pv - av;
                      const pct = diffPct(av, pv);
                      const dCls = d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "";
                      return (
                        <Fragment>
                          <TableCell className="px-2 py-1 text-right tabular-nums border-l">{fmtMoeda(av)}</TableCell>
                          <TableCell className="px-2 py-1 text-right tabular-nums">{fmtMoeda(pv)}</TableCell>
                          <TableCell className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{d >= 0 ? "+" : ""}{fmtMoeda(d)}</TableCell>
                          {showPct && <TableCell className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{fmtPct(pct)}</TableCell>}
                        </Fragment>
                      );
                    })()}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ResumoComparativoTable titulo="Resumo Gerencial por Empresa" rows={resumoPorEmpresa} showPct={showPct} />
      <ResumoComparativoTable titulo="Resumo Gerencial por Grupo" rows={resumoPorGrupo} showPct={showPct} />
      <ResumoComparativoTable titulo="Resumo Gerencial por Unidade" rows={resumoPorUnidade} showPct={showPct} />
      </div>
    </div>
  );
}

type BreakdownVal = { servicos: number; frota: number; partidas: number; km: number; custo: number };

const BREAKDOWN_METRICS: { key: keyof BreakdownVal; label: string; fmt: (n: number) => string }[] = [
  { key: "servicos", label: "Serviços", fmt: fmtInt },
  { key: "frota", label: "Frota", fmt: fmtInt },
  { key: "partidas", label: "Partidas", fmt: fmtInt },
  { key: "km", label: "KM", fmt: (n) => fmtKm(n) },
];

function ResumoComparativoTable({ titulo, rows, showPct }: { titulo: string; rows: { chave: string; atual: BreakdownVal; proposta: BreakdownVal }[]; showPct: boolean }) {
  if (rows.length === 0) return null;
  const comCusto = rows.some((r) => r.atual.custo > 0 || r.proposta.custo > 0);
  const metrics = comCusto ? [...BREAKDOWN_METRICS, { key: "custo" as const, label: "Custo M.O.", fmt: fmtMoeda }] : BREAKDOWN_METRICS;
  const colsPerMetric = showPct ? 4 : 3;
  const totA = rows.reduce((s, r) => ({ servicos: s.servicos + r.atual.servicos, frota: s.frota + r.atual.frota, partidas: s.partidas + r.atual.partidas, km: s.km + r.atual.km, custo: s.custo + r.atual.custo }), { servicos: 0, frota: 0, partidas: 0, km: 0, custo: 0 });
  const totP = rows.reduce((s, r) => ({ servicos: s.servicos + r.proposta.servicos, frota: s.frota + r.proposta.frota, partidas: s.partidas + r.proposta.partidas, km: s.km + r.proposta.km, custo: s.custo + r.proposta.custo }), { servicos: 0, frota: 0, partidas: 0, km: 0, custo: 0 });
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{titulo}</CardTitle></CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="px-2 py-1" rowSpan={2}></TableHead>
                {metrics.map((m) => (
                  <TableHead key={String(m.key)} className="px-2 py-1 text-center border-l" colSpan={colsPerMetric}>{m.label}</TableHead>
                ))}
              </TableRow>
              <TableRow className="h-7">
                {metrics.map((m) => (
                  <Fragment key={String(m.key)}>
                    <TableHead className="px-2 py-1 text-right border-l text-[10px] uppercase tracking-wider text-blue-600">Atual</TableHead>
                    <TableHead className="px-2 py-1 text-right text-[10px] uppercase tracking-wider text-emerald-600">Prop.</TableHead>
                    <TableHead className="px-2 py-1 text-right text-[10px] uppercase tracking-wider">Δ</TableHead>
                    {showPct && <TableHead className="px-2 py-1 text-right text-[10px] uppercase tracking-wider">Δ%</TableHead>}
                  </Fragment>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.chave} className="h-8">
                  <TableCell className="px-2 py-1 font-medium">{r.chave}</TableCell>
                  {metrics.map((m) => {
                    const av = r.atual[m.key];
                    const pv = r.proposta[m.key];
                    const d = pv - av;
                    const pct = diffPct(av, pv);
                    const dCls = d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "text-muted-foreground";
                    return (
                      <Fragment key={String(m.key)}>
                        <TableCell className="px-2 py-1 text-right tabular-nums border-l">{m.fmt(av)}</TableCell>
                        <TableCell className="px-2 py-1 text-right tabular-nums">{m.fmt(pv)}</TableCell>
                        <TableCell className={`px-2 py-1 text-right tabular-nums font-semibold ${dCls}`}>{fmtDelta(d, m.fmt)}</TableCell>
                        {showPct && <TableCell className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{fmtPct(pct)}</TableCell>}
                      </Fragment>
                    );
                  })}
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-bold h-9">
                <TableCell className="px-2 py-1">TOTAL</TableCell>
                {metrics.map((m) => {
                  const av = totA[m.key];
                  const pv = totP[m.key];
                  const d = pv - av;
                  const pct = diffPct(av, pv);
                  const dCls = d > 0 ? "text-emerald-600" : d < 0 ? "text-red-600" : "";
                  return (
                    <Fragment key={String(m.key)}>
                      <TableCell className="px-2 py-1 text-right tabular-nums border-l">{m.fmt(av)}</TableCell>
                      <TableCell className="px-2 py-1 text-right tabular-nums">{m.fmt(pv)}</TableCell>
                      <TableCell className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{fmtDelta(d, m.fmt)}</TableCell>
                      {showPct && <TableCell className={`px-2 py-1 text-right tabular-nums ${dCls}`}>{fmtPct(pct)}</TableCell>}
                    </Fragment>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
