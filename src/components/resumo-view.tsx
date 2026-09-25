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
import { buildEmpresaOverrideMap, resolveEmpresaViagem, resolveGrupoViagem, resolveUnidadeViagem, buildEmpresaPorServico, buildGrupoPorServico, buildUnidadePorServico } from "@/lib/empresa-estacao";
import { buildJornadas } from "@/lib/jornada";
import { custoServico, fmtMoeda } from "@/lib/custo";
import { useSalarioMotorista } from "@/components/salario-motorista";
import { buildKmMaps, viagemKm, viagemKmResult, fmtKm, fmtInt, normKey } from "@/lib/km";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Bus, Users, Activity, Gauge, FileSpreadsheet, FileText, Layers, AlertTriangle, Play, RotateCcw, Printer } from "lucide-react";
import { MultiSelect } from "@/components/multi-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
// xlsx-js-style (fork da SheetJS community, mesma API) em vez de "xlsx"
// puro: a "xlsx" comunidade não escreve estilo de célula (cor de
// fundo/fonte) no arquivo gerado — só a versão paga faz isso.
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PdfPreviewDialog, type PdfOrientation } from "@/components/pdf-preview-dialog";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { PDF_BLUE, PDF_BLUE_LIGHT, PDF_LINE_BLUE, XLSX_BLUE, XLSX_BLUE_LIGHT, XLSX_LINE_BLUE } from "@/lib/report-style";

const fetchViagens = fetchAllViagens;

function parseHHMM(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// Arredonda ANTES de calcular somas/diferenças — soma de muitos valores
// decimais (KM, principalmente) acumula ruído de ponto flutuante (ex.:
// -4,5e-13 em vez de 0).
function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Campos alternáveis em "Campos visíveis" — mesmo padrão do Relatório
 * Comparativo: controla o que aparece na tela E no PDF/Excel. */
type ResumoFieldKey = "dir1" | "dir2" | "aprov" | "tu" | "totalServico" | "frota" | "partidas" | "km";
const RESUMO_FIELDS: { key: ResumoFieldKey; label: string; fmt: (n: number) => string }[] = [
  { key: "dir1", label: "Dir 1º T.", fmt: fmtInt },
  { key: "dir2", label: "Dir 2º T.", fmt: fmtInt },
  { key: "aprov", label: "Aproveit.", fmt: fmtInt },
  { key: "tu", label: "TU", fmt: fmtInt },
  { key: "totalServico", label: "Serviços", fmt: fmtInt },
  { key: "frota", label: "Frota", fmt: fmtInt },
  { key: "partidas", label: "Partidas", fmt: fmtInt },
  { key: "km", label: "KM", fmt: (n) => fmtKm(n) },
];

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
  const [somenteAtivos, setSomenteAtivos] = usePersistentState(`resumo.${mode}.somenteAtivos`, false);
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
  const [mostrarDescricao, setMostrarDescricao] = usePersistentState(`resumo.${mode}.mostrarDescricao`, false);
  const [mostrarCusto, setMostrarCusto] = usePersistentState(`resumo.${mode}.mostrarCusto`, false);
  // Campos visíveis — controla tela E exportação (PDF/Excel), igual ao
  // Relatório Comparativo. Por padrão todos ligados (comportamento antigo).
  const [visibleFieldsArr, setVisibleFieldsArr] = usePersistentState<string[]>(
    `resumo.${mode}.visibleFields`,
    RESUMO_FIELDS.map((f) => f.key as string),
  );
  const visibleFields = useMemo(() => new Set(visibleFieldsArr), [visibleFieldsArr]);
  const shownFields = useMemo(() => RESUMO_FIELDS.filter((f) => visibleFields.has(f.key)), [visibleFields]);
  function toggleField(k: string) {
    const next = new Set(visibleFields);
    if (next.has(k)) next.delete(k); else next.add(k);
    setVisibleFieldsArr(Array.from(next));
  }

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
    if (S.unidade !== "__all" && resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) !== S.unidade) return false;
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

  // Descrição da linha (ex.: "ALCÂNTARA X MÉIER"), só faz sentido no modo
  // "Resumo por Linha". Pega o trecho mais comum entre as viagens
  // Comercial + Ida daquela linha, e busca a descrição cadastrada em KM
  // pra esse trecho específico.
  const descricaoPorLinha = useMemo(() => {
    if (mode !== "linha" || !mostrarDescricao) return new Map<string, string>();
    const descTrecho = new Map<string, string>();
    for (const k of km) {
      if (!k.descricao?.trim()) continue;
      descTrecho.set(`${normKey(k.linha)}|${normKey(k.origem)}|${normKey(k.destino)}`, k.descricao.trim());
    }
    // Prioriza o trecho de viagens Comercial+Ida (é o mais "correto"
    // pra descrever a linha), mas se a linha não tiver nenhuma viagem
    // assim, não desiste — usa o trecho mais comum entre TODAS as
    // viagens dela, senão linha nenhuma ficaria sem descrição à toa.
    const tally = new Map<string, Map<string, number>>();
    for (const v of filtered) {
      const trechoKey = `${normKey(v.origem)}|${normKey(v.destino)}`;
      const ehComercialIda = (v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL"
        && (v.sentido ?? "").trim().toUpperCase() === "IDA";
      const peso = ehComercialIda ? 1000 : 1; // garante prioridade sem descartar o resto
      const m = tally.get(v.linha) ?? new Map<string, number>();
      m.set(trechoKey, (m.get(trechoKey) ?? 0) + peso);
      tally.set(v.linha, m);
    }
    // Índice auxiliar: qualquer descrição já cadastrada pra essa linha em
    // KM, não importa o trecho — usado como último recurso.
    const descQualquerPorLinha = new Map<string, string>();
    for (const k of km) {
      if (!k.descricao?.trim()) continue;
      const l = normKey(k.linha);
      if (!descQualquerPorLinha.has(l)) descQualquerPorLinha.set(l, k.descricao.trim());
    }
    const out = new Map<string, string>();
    for (const [linha, m] of tally) {
      let bestTrecho: string | null = null, bestN = -1;
      for (const [trecho, n] of m) if (n > bestN) { bestTrecho = trecho; bestN = n; }
      if (!bestTrecho) continue;
      const desc = descTrecho.get(`${normKey(linha)}|${bestTrecho}`) ?? descQualquerPorLinha.get(normKey(linha));
      if (desc) out.set(linha, desc);
    }
    return out;
  }, [mode, mostrarDescricao, km, filtered]);

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

  // Unidade (cadastro de Linhas, com exceção por estação) de cada linha de
  // resumo. Em modo "linha", tally por linha diretamente das viagens
  // (respeitando a exceção por estação). Em modo "grupo"/"versão", usa a
  // unidade predominante já resolvida por serviço (buildUnidadePorServico).
  const unidadePorServico = useMemo(
    () => buildUnidadePorServico(filtered, linhaMap, empresaOverrideMap),
    [filtered, linhaMap, empresaOverrideMap],
  );
  const unidadePorGrupo = useMemo(() => {
    if (mode === "linha") {
      const tally = new Map<string, Map<string, number>>();
      for (const v of filtered) {
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
    }
    const tally = new Map<string, Map<string, number>>();
    for (const u of units.values()) {
      const unidade = unidadePorServico.get(u.vehicleKey);
      if (!unidade) continue;
      const linhaDom = dominantLinha(u, S.criterio);
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
  }, [units, mode, S.groupBy, S.criterio, S.dia, grupoMap, filtered, linhaMap, empresaOverrideMap, unidadePorServico]);

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

  // Linhas/grupos agrupados por Unidade, na ordem que os relatórios de
  // exportação (Excel/PDF) usam — mesmo formato "por Unidade" nos dois
  // modos (Resumo por Linha e Resumo Operacional), só muda a granularidade
  // de `rows` (linha individual ou grupo/versão, já vem pronta de `rows`).
  // Grupo de Linha "primário" de cada linha (independente de dia tipo) —
  // usado só pra ordenação secundária dentro de cada Unidade: dentro da
  // Unidade, agrupa as linhas do mesmo Grupo de Linha juntas (ex.: 01, 01A,
  // 49A), em vez de alfabética pura por código de linha.
  const grupoDuPorLinha = useMemo(() => {
    const tally = new Map<string, Map<string, number>>();
    for (const m of multi) {
      if (!m.grupo_du) continue;
      const t = tally.get(m.linha) ?? new Map<string, number>();
      t.set(m.grupo_du, (t.get(m.grupo_du) ?? 0) + 1);
      tally.set(m.linha, t);
    }
    const out = new Map<string, string>();
    for (const [linha, t] of tally) {
      let best: string | null = null, bestN = -1;
      for (const [g, n] of t) if (n > bestN) { best = g; bestN = n; }
      if (best) out.set(linha, best);
    }
    return out;
  }, [multi]);

  // No modo "linha", cada row É uma linha (busca o grupo dela). No modo
  // "grupo" com groupBy="grupo", cada row JÁ é o grupo. No modo "versão"
  // não há noção de Grupo de Linha — mantém o próprio rótulo (equivale à
  // ordenação alfabética de antes).
  // Grupo de Linha é cadastrado POR DIA TIPO — busca o grupo cadastrado pro
  // dia tipo aplicado no filtro (S.dia); só cai pro "mais frequente" (sem
  // olhar dia tipo) se o filtro estiver em "Todos os dias".
  function grupoParaOrdenar(r: AggRow): string {
    if (mode !== "linha") return r.groupLabel;
    if (S.dia !== "__all") {
      const g = grupoMap.get(`${r.groupLabel}|${S.dia}`.toLowerCase());
      if (g) return g;
    }
    return grupoDuPorLinha.get(r.groupLabel) ?? `zzz_${r.groupLabel}`;
  }

  const rowsPorUnidadeExport = useMemo(() => {
    const grupos = new Map<string, AggRow[]>();
    for (const r of rows) {
      const un = unidadePorGrupo.get(r.groupKey) || "Sem unidade";
      const arr = grupos.get(un) ?? [];
      arr.push(r);
      grupos.set(un, arr);
    }
    for (const arr of grupos.values()) {
      arr.sort((a, b) => {
        const ga = grupoParaOrdenar(a), gb = grupoParaOrdenar(b);
        if (ga !== gb) return ga.localeCompare(gb, "pt-BR", { numeric: true, sensitivity: "base" });
        return a.groupLabel.localeCompare(b.groupLabel, "pt-BR", { numeric: true, sensitivity: "base" });
      });
    }
    return Array.from(grupos, ([unidade, rows]) => ({ unidade, rows })).sort((a, b) => a.unidade.localeCompare(b.unidade, "pt-BR"));
  }, [rows, unidadePorGrupo, grupoDuPorLinha, mode, S.dia, grupoMap]);


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

  // Validação obrigatória da regra de Frota: soma por linha == veículos
  // distintos — usa o mesmo critério (S.criterio) que gerou os números de
  // Frota exibidos na tela, senão a validação pode dizer "OK" checando uma
  // regra diferente da que produziu o que está na tela.
  const frotaValidacao = useMemo(() => validarConsistenciaFrota(units, viagensParaOrigem, S.criterio), [units, viagensParaOrigem, S.criterio]);

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
  // Jornadas de verdade (com HE/noturno) só pra calcular custo de mão de
  // obra certo nos resumos — não é usado pra mais nada nessa tela.
  const { params: custoParams } = useSalarioMotorista();
  const jornadasParaCusto = useMemo(() => buildJornadas(filtered, linhas), [filtered, linhas]);
  function custoPorChave(chaveFn: (j: ReturnType<typeof buildJornadas>[number]) => string): Map<string, number> {
    const m = new Map<string, number>();
    if (!custoParams) return m;
    for (const j of jornadasParaCusto) {
      // TU incompleto (só T1 ou só T2) não entra em nenhum total de
      // jornada (mesma regra de jornadaTotais em src/lib/jornada.ts) — não
      // pode entrar no custo de mão de obra também.
      if (j.incompleto) continue;
      const k = chaveFn(j);
      m.set(k, (m.get(k) ?? 0) + custoServico(j, custoParams));
    }
    return m;
  }

  // Custo por linha do resumo principal (mesmo groupKey usado em "rows",
  // pra mostrar a coluna "Custo M.O." junto de Partidas/KM na tabela).
  const vehicleKeyParaGroupKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units.values()) {
      let key: string;
      if (mode === "linha") {
        key = dominantLinha(u, S.criterio);
      } else if (S.groupBy === "grupo") {
        const linha = dominantLinha(u, S.criterio);
        const td = S.dia !== "__all" ? S.dia : u.tipo_operacao;
        key = grupoMap.get(`${linha}|${td}`.toLowerCase()) ?? `(sem grupo) ${linha}`;
      } else {
        key = u.versao;
      }
      m.set(u.vehicleKey, key);
    }
    return m;
  }, [units, mode, S.groupBy, S.criterio, S.dia, grupoMap]);
  const custoPorGroupKey = useMemo(
    () => custoPorChave((j) => vehicleKeyParaGroupKey.get(j.vehicleKey) ?? "?"),
    [jornadasParaCusto, custoParams, vehicleKeyParaGroupKey],
  );

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
    const custoMap = custoPorChave((j) => empresaPorServico.get(j.vehicleKey) || linhaMap.get(j.linha)?.empresa || "Sem empresa");
    return Array.from(m, ([empresa, x]) => ({
      empresa, partidas: x.partidas, km: x.km, servicos: x.servicos.size, frota: x.veiculos.size,
      custo: custoMap.get(empresa) ?? 0,
    })).sort((a, b) => a.empresa.localeCompare(b.empresa));
  }, [units, filtered, linhaMap, kmFn, S.criterio, empresaPorServico, empresaOverrideMap, jornadasParaCusto, custoParams]);

  // Resumo por Unidade (rodapé gerencial)
  const resumoUnidade = useMemo(() => {
    const m = new Map<string, { partidas: number; km: number; servicos: Set<string>; veiculos: Set<string> }>();
    for (const u of units.values()) {
      const unidade = unidadePorServico.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, S.criterio))?.unidade || "Sem unidade";
      if (!m.has(unidade)) m.set(unidade, { partidas: 0, km: 0, servicos: new Set(), veiculos: new Set() });
      m.get(unidade)!.servicos.add(u.key);
      m.get(unidade)!.veiculos.add(u.vehicleKey);
    }
    for (const v of filtered) {
      const un = resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) || "Sem unidade";
      if (!m.has(un)) m.set(un, { partidas: 0, km: 0, servicos: new Set(), veiculos: new Set() });
      if ((v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL" && v.partida) m.get(un)!.partidas += 1;
      m.get(un)!.km += kmFn(v);
    }
    const custoMap = custoPorChave((j) => unidadePorServico.get(j.vehicleKey) || linhaMap.get(j.linha)?.unidade || "Sem unidade");
    return Array.from(m, ([unidade, x]) => ({
      unidade, partidas: x.partidas, km: x.km, servicos: x.servicos.size, frota: x.veiculos.size,
      custo: custoMap.get(unidade) ?? 0,
    })).sort((a, b) => a.unidade.localeCompare(b.unidade));
  }, [units, filtered, linhaMap, kmFn, S.criterio, unidadePorServico, empresaOverrideMap, jornadasParaCusto, custoParams]);

  // Resumo por Grupo (rodapé gerencial) — campo "Grupo" (ex-Ordem, com
  // exceção por estação tipo Grupo Rio Ita/Grupo Maua), NÃO é "Grupo de
  // Linha" (grupo_du, esse é outro campo, usado no filtro/agrupamento acima).
  const grupoPorServico = useMemo(
    () => buildGrupoPorServico(filtered, linhaMap, empresaOverrideMap),
    [filtered, linhaMap, empresaOverrideMap],
  );
  const resumoGrupoLinha = useMemo(() => {
    const m = new Map<string, { partidas: number; km: number; servicos: Set<string>; veiculos: Set<string> }>();
    for (const u of units.values()) {
      const grupo = grupoPorServico.get(u.vehicleKey) || linhaMap.get(dominantLinha(u, S.criterio))?.ordem || "Sem grupo";
      if (!m.has(grupo)) m.set(grupo, { partidas: 0, km: 0, servicos: new Set(), veiculos: new Set() });
      m.get(grupo)!.servicos.add(u.key);
      m.get(grupo)!.veiculos.add(u.vehicleKey);
    }
    for (const v of filtered) {
      const grupo = resolveGrupoViagem(v, linhaMap, empresaOverrideMap) || "Sem grupo";
      if (!m.has(grupo)) m.set(grupo, { partidas: 0, km: 0, servicos: new Set(), veiculos: new Set() });
      if ((v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL" && v.partida) m.get(grupo)!.partidas += 1;
      m.get(grupo)!.km += kmFn(v);
    }
    const custoMap = custoPorChave((j) => grupoPorServico.get(j.vehicleKey) || linhaMap.get(j.linha)?.ordem || "Sem grupo");
    return Array.from(m, ([grupo, x]) => ({
      grupo, partidas: x.partidas, km: x.km, servicos: x.servicos.size, frota: x.veiculos.size,
      custo: custoMap.get(grupo) ?? 0,
    })).sort((a, b) => a.grupo.localeCompare(b.grupo));
  }, [units, filtered, linhaMap, kmFn, S.criterio, grupoPorServico, empresaOverrideMap, jornadasParaCusto, custoParams]);

  const title = mode === "linha" ? "Resumo por Linha" : "Resumo Operacional";
  const firstColLabel = mode === "linha" ? "Linha" : (groupBy === "grupo" ? "Grupo de Linha" : "Projeto / Versão");
  const comCustoTabela = mostrarCusto && !!custoParams && custoParams.salarioMotoristaMensal > 0;
  const headers = [firstColLabel, ...shownFields.map((f) => f.label), ...(comCustoTabela ? ["Custo M.O."] : [])];

  function exportXLSX() {
    const wb = XLSX.utils.book_new();
    const comDescricao = mode === "linha" && mostrarDescricao;

    // Layout "por Unidade" (mesmo dos dois modos): um bloco por Unidade —
    // título, cabeçalho azul, linhas, TOTAL em azul claro — seguido do
    // mini-resumo por Unidade. Usa xlsx-js-style pra cor de célula (a
    // "xlsx" comunidade ignora estilo ao salvar).
    type RowKind = "title" | "subtitle" | "blank" | "unidade" | "header" | "body" | "total" | "miniHeader" | "miniBody" | "miniTotal";
    const headerRow = [firstColLabel, ...(comDescricao ? ["Descrição"] : []), ...shownFields.map((f) => f.label), ...(comCustoTabela ? ["Custo M.O."] : [])];
    const nCols = headerRow.length;
    const rowsAll: (string | number)[][] = [];
    const kinds: RowKind[] = [];
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    const push = (r: (string | number)[], k: RowKind) => { rowsAll.push(r); kinds.push(k); };
    const fieldVals = (r: Record<ResumoFieldKey, number>) => shownFields.map((f) => f.key === "km" ? roundTo(r.km, 1) : r[f.key]);

    push([title.toUpperCase()], "title");
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } });
    push([`Gerado em ${new Date().toLocaleString("pt-BR")} — ${rows.length} ${mode === "linha" ? "linha(s)" : "grupo(s)"}`], "subtitle");
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: nCols - 1 } });
    push([], "blank");

    for (const grupo of rowsPorUnidadeExport) {
      push([`UNIDADE ${grupo.unidade.toUpperCase()}`], "unidade");
      merges.push({ s: { r: rowsAll.length - 1, c: 0 }, e: { r: rowsAll.length - 1, c: nCols - 1 } });
      push(headerRow, "header");
      for (const r of grupo.rows) {
        push([
          r.groupLabel,
          ...(comDescricao ? [descricaoPorLinha.get(r.groupKey) ?? ""] : []),
          ...fieldVals(r),
          ...(comCustoTabela ? [roundTo(custoPorGroupKey.get(r.groupKey) ?? 0, 2)] : []),
        ], "body");
      }
      const tot = grupo.rows.reduce((s, r) => ({
        dir1: s.dir1 + r.dir1, dir2: s.dir2 + r.dir2, aprov: s.aprov + r.aprov, tu: s.tu + r.tu,
        totalServico: s.totalServico + r.totalServico, frota: s.frota + r.frota, partidas: s.partidas + r.partidas,
        km: s.km + r.km, custo: s.custo + (custoPorGroupKey.get(r.groupKey) ?? 0),
      }), { dir1: 0, dir2: 0, aprov: 0, tu: 0, totalServico: 0, frota: 0, partidas: 0, km: 0, custo: 0 });
      push([
        "TOTAL", ...(comDescricao ? [""] : []),
        ...fieldVals(tot),
        ...(comCustoTabela ? [roundTo(tot.custo, 2)] : []),
      ], "total");
      push([], "blank");
    }

    // Mini-resumo por Unidade (Serviços/Frota/Partidas/KM), no rodapé.
    push(["Unidade", "Serviços", "Frota", "Partidas", "KM"], "miniHeader");
    for (const u of resumoUnidade) push([u.unidade, u.servicos, u.frota, u.partidas, roundTo(u.km, 1)], "miniBody");
    push([
      "TOTAL",
      resumoUnidade.reduce((s, u) => s + u.servicos, 0),
      resumoUnidade.reduce((s, u) => s + u.frota, 0),
      resumoUnidade.reduce((s, u) => s + u.partidas, 0),
      roundTo(resumoUnidade.reduce((s, u) => s + u.km, 0), 1),
    ], "miniTotal");

    const ws = XLSX.utils.aoa_to_sheet(rowsAll);
    ws["!merges"] = merges;
    const colsFields = shownFields.map((f) => ({ wch: f.key === "km" ? 12 : 10 }));
    const cols = [{ wch: 22 }, ...(comDescricao ? [{ wch: 30 }] : []), ...colsFields, ...(comCustoTabela ? [{ wch: 14 }] : [])];
    ws["!cols"] = cols;

    const FILL_BLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE } };
    const FILL_LIGHTBLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE_LIGHT } };
    const THIN = { style: "thin", color: { rgb: "B4B4B4" } };
    const border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
    rowsAll.forEach((row, r) => {
      const kind = kinds[r];
      if (kind === "blank") return;
      for (let c = 0; c < row.length; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = (ws as any)[addr];
        if (!cell) continue;
        if (kind === "title") cell.s = { font: { bold: true, sz: 13, color: { rgb: XLSX_LINE_BLUE } }, alignment: { horizontal: "center" } };
        else if (kind === "subtitle") cell.s = { font: { sz: 9, color: { rgb: "666666" } }, alignment: { horizontal: "center" } };
        else if (kind === "unidade") cell.s = { font: { bold: true, sz: 11 }, alignment: { horizontal: "left" } };
        else if (kind === "header" || kind === "miniHeader") cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: FILL_BLUE, alignment: { horizontal: "center" }, border };
        else if (kind === "body" || kind === "miniBody") cell.s = { font: c === 0 ? { bold: true, color: { rgb: XLSX_LINE_BLUE } } : { color: { rgb: "000000" } }, alignment: { horizontal: "center" }, border };
        else if (kind === "total" || kind === "miniTotal") cell.s = { font: { bold: true, color: { rgb: "000000" } }, fill: FILL_LIGHTBLUE, alignment: { horizontal: "center" }, border };
      }
    });
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));

    // Aba Empresa
    appendResumoSheet(wb, "Empresa", "empresa", resumoEmpresa);
    appendResumoSheet(wb, "Unidade", "unidade", resumoUnidade);
    appendResumoSheet(wb, "Grupo", "grupo", resumoGrupoLinha);

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
      // "Gerado em" entra na linha do subtítulo (centralizada) em vez do
      // canto — evita colidir com o título centralizado.
      const geradoEmTxt = `Gerado em ${new Date().toLocaleString("pt-BR")}`;
      const subtitleTxt = `Período: ${periodoTxt} — ${rows.length} ${mode === "linha" ? "linha(s)" : "grupo(s)"} · TU único · Frota = veículos físicos distintos — ${geradoEmTxt}`;

      function drawHeader(d: InstanceType<typeof jsPDF>) {
        d.setTextColor(...PDF_LINE_BLUE); d.setFont("helvetica", "bold"); d.setFontSize(12);
        d.text(title.toUpperCase(), pageW / 2, 8, { align: "center" });
        d.setFontSize(6.8); d.setTextColor(90); d.setFont("helvetica", "normal");
        d.text(subtitleTxt, pageW / 2, 13, { align: "center" });
        d.setDrawColor(...PDF_LINE_BLUE); d.setLineWidth(0.5);
        d.line(10, 15, pageW - 10, 15);
        d.setTextColor(20);
      }

      const comDescricaoPdf = mode === "linha" && mostrarDescricao;
      const headersPdf = [firstColLabel, ...(comDescricaoPdf ? ["Descrição"] : []), ...shownFields.map((f) => f.label), ...(comCustoTabela ? ["Custo M.O."] : [])];
      const fieldValsPdf = (r: Record<ResumoFieldKey, number>) => shownFields.map((f) => f.fmt(r[f.key]));
      const empBody = resumoEmpresa.map((e) => [e.empresa, fmtInt(e.servicos), fmtInt(e.frota), fmtInt(e.partidas), fmtKm(e.km)]);
      const empHeaders = ["Empresa", "Serviços", "Frota", "Partidas", "KM"];
      const empFoot = ["TOTAL",
        fmtInt(resumoEmpresa.reduce((s, e) => s + e.servicos, 0)),
        fmtInt(resumoEmpresa.reduce((s, e) => s + e.frota, 0)),
        fmtInt(resumoEmpresa.reduce((s, e) => s + e.partidas, 0)),
        fmtKm(resumoEmpresa.reduce((s, e) => s + e.km, 0)),
      ];
      const uniBody = resumoUnidade.map((e) => [e.unidade, fmtInt(e.servicos), fmtInt(e.frota), fmtInt(e.partidas), fmtKm(e.km)]);
      const uniHeaders = ["Unidade", "Serviços", "Frota", "Partidas", "KM"];
      const uniFoot = ["TOTAL",
        fmtInt(resumoUnidade.reduce((s, e) => s + e.servicos, 0)),
        fmtInt(resumoUnidade.reduce((s, e) => s + e.frota, 0)),
        fmtInt(resumoUnidade.reduce((s, e) => s + e.partidas, 0)),
        fmtKm(resumoUnidade.reduce((s, e) => s + e.km, 0)),
      ];
      const grpBody = resumoGrupoLinha.map((e) => [e.grupo, fmtInt(e.servicos), fmtInt(e.frota), fmtInt(e.partidas), fmtKm(e.km)]);
      const grpHeaders = ["Grupo", "Serviços", "Frota", "Partidas", "KM"];
      const grpFoot = ["TOTAL",
        fmtInt(resumoGrupoLinha.reduce((s, e) => s + e.servicos, 0)),
        fmtInt(resumoGrupoLinha.reduce((s, e) => s + e.frota, 0)),
        fmtInt(resumoGrupoLinha.reduce((s, e) => s + e.partidas, 0)),
        fmtKm(resumoGrupoLinha.reduce((s, e) => s + e.km, 0)),
      ];

      const blockRowsPdf = rowsPorUnidadeExport.flatMap((grupo) => grupo.rows.map((r) => [
        r.groupLabel,
        ...(comDescricaoPdf ? [descricaoPorLinha.get(r.groupKey) ?? ""] : []),
        ...fieldValsPdf(r),
        ...(comCustoTabela ? [fmtMoeda(custoPorGroupKey.get(r.groupKey) ?? 0)] : []),
      ]));
      const blockFootPdf = ["TOTAL", ...(comDescricaoPdf ? [""] : []), ...fieldValsPdf(totals), ...(comCustoTabela ? [fmtMoeda(Array.from(custoPorGroupKey.values()).reduce((s, v) => s + v, 0))] : [])];

      // Largura natural calculada só com getTextWidth (API padrão do jsPDF)
      // — por coluna, pra dar cellWidth explícita e garantir que todo bloco
      // de Unidade use a MESMA largura (senão cada bloco auto-ajustava só
      // com o próprio conteúdo e as colunas ficavam desalinhadas entre si).
      function tableColWidths(fontSize: number, headerRow: string[], bodyRows: any[][], footRow: any[]) {
        const padX = 2 * (fontSize / 8);
        probe.setFontSize(fontSize);
        return headerRow.map((_, c) => {
          let maxW = 0;
          const cellsInCol = [headerRow[c], ...bodyRows.map((r) => r[c]), footRow[c]];
          for (const cell of cellsInCol) {
            probe.setFont("helvetica", "bold");
            const w = probe.getTextWidth(String(cell ?? ""));
            if (w > maxW) maxW = w;
          }
          return maxW + padX * 2;
        });
      }
      function tableNaturalWidth(fontSize: number, headerRow: string[], bodyRows: any[][], footRow: any[]) {
        return tableColWidths(fontSize, headerRow, bodyRows, footRow).reduce((s, w) => s + w, 0);
      }
      function naturalWidth(fontSize: number) {
        const mainW = tableNaturalWidth(fontSize, headersPdf, blockRowsPdf, blockFootPdf);
        const empW = tableNaturalWidth(fontSize - 0.3, empHeaders, empBody, empFoot);
        return Math.max(mainW, empW);
      }

      function draw(zoom: number, marginLeft: number) {
        const d = new jsPDF({ orientation, unit: "mm", format: "a4" });
        const fontSize = 8 * zoom;
        const padY = 1.5 * zoom;
        const styleBase = { fontSize, cellPadding: { top: padY, right: 2 * zoom, bottom: padY, left: 2 * zoom }, halign: "center" as const, valign: "middle" as const, overflow: "linebreak" as const, lineColor: [180, 180, 180] as [number, number, number], lineWidth: 0.18 };
        const headStyleBase = { fillColor: PDF_BLUE, textColor: 255, fontSize: fontSize + 0.5, halign: "center" as const, fontStyle: "bold" as const, cellPadding: padY + 0.4 * zoom };
        const footStyleBase = { fillColor: PDF_BLUE_LIGHT, textColor: 20, fontStyle: "bold" as const, halign: "center" as const };
        // Coluna 0 (Linha/Grupo) em azul/negrito só no corpo — total já é
        // preto/negrito via footStyleBase.
        const blueCol0 = (data: any) => {
          if (data.section === "body" && data.column.index === 0) {
            data.cell.styles.textColor = PDF_LINE_BLUE;
            data.cell.styles.fontStyle = "bold";
          }
        };
        // Larguras fixas por coluna (mesma pra todo bloco de Unidade).
        const mainWidths = tableColWidths(fontSize, headersPdf, blockRowsPdf, blockFootPdf);
        const columnStylesMain: Record<number, { cellWidth: number; halign: "center" }> = {};
        mainWidths.forEach((w, i) => { columnStylesMain[i] = { cellWidth: w, halign: "center" }; });

        // Um bloco de tabela por Unidade, cada um com seu próprio TOTAL —
        // mesmo formato nos dois modos (Resumo por Linha / Operacional) e
        // no Excel.
        let y = HEADER_H + 3;
        for (const grupo of rowsPorUnidadeExport) {
          d.setFontSize(9 * zoom); d.setFont("helvetica", "bold"); d.setTextColor(20);
          d.text(`UNIDADE ${grupo.unidade.toUpperCase()}`, marginLeft, y + 3 * zoom);
          const groupBody = grupo.rows.map((r) => [
            r.groupLabel,
            ...(comDescricaoPdf ? [descricaoPorLinha.get(r.groupKey) ?? ""] : []),
            ...fieldValsPdf(r),
            ...(comCustoTabela ? [fmtMoeda(custoPorGroupKey.get(r.groupKey) ?? 0)] : []),
          ]);
          const tot = grupo.rows.reduce((s, r) => ({
            dir1: s.dir1 + r.dir1, dir2: s.dir2 + r.dir2, aprov: s.aprov + r.aprov, tu: s.tu + r.tu,
            totalServico: s.totalServico + r.totalServico, frota: s.frota + r.frota, partidas: s.partidas + r.partidas,
            km: s.km + r.km, custo: s.custo + (custoPorGroupKey.get(r.groupKey) ?? 0),
          }), { dir1: 0, dir2: 0, aprov: 0, tu: 0, totalServico: 0, frota: 0, partidas: 0, km: 0, custo: 0 });
          const groupFoot = ["TOTAL", ...(comDescricaoPdf ? [""] : []), ...fieldValsPdf(tot), ...(comCustoTabela ? [fmtMoeda(tot.custo)] : [])];
          autoTable(d, {
            startY: y + 5 * zoom,
            head: [headersPdf],
            body: groupBody,
            foot: [groupFoot],
            styles: styleBase,
            columnStyles: columnStylesMain,
            headStyles: headStyleBase,
            footStyles: footStyleBase,
            didParseCell: blueCol0,
            margin: { left: marginLeft, right: 10, top: HEADER_H + 3, bottom: 12 },
            theme: "grid",
            tableWidth: "wrap",
            pageBreak: "avoid",
            rowPageBreak: "avoid",
            didDrawPage: () => drawHeader(d),
          });
          y = (d as any).lastAutoTable.finalY + 6 * zoom;
        }
        // Mini-resumo por Unidade, mesmo formato do Excel.
        d.setFontSize(9 * zoom); d.setFont("helvetica", "bold"); d.setTextColor(20);
        const miniBody = resumoUnidade.map((u) => [u.unidade, fmtInt(u.servicos), fmtInt(u.frota), fmtInt(u.partidas), fmtKm(u.km)]);
        const miniFoot = ["TOTAL",
          fmtInt(resumoUnidade.reduce((s, u) => s + u.servicos, 0)),
          fmtInt(resumoUnidade.reduce((s, u) => s + u.frota, 0)),
          fmtInt(resumoUnidade.reduce((s, u) => s + u.partidas, 0)),
          fmtKm(resumoUnidade.reduce((s, u) => s + u.km, 0)),
        ];
        autoTable(d, {
          startY: y + 2 * zoom,
          head: [["Unidade", "Serviços", "Frota", "Partidas", "KM"]],
          body: miniBody,
          foot: [miniFoot],
          styles: styleBase,
          headStyles: headStyleBase,
          footStyles: footStyleBase,
          didParseCell: blueCol0,
          margin: { left: marginLeft, right: 10, top: HEADER_H + 3, bottom: 12 },
          theme: "grid",
          tableWidth: "wrap",
          pageBreak: "avoid",
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
          styles: { fontSize: fontSize - 0.3, cellPadding: Math.max(padY - 0.2 * zoom, 0.3), halign: "center", valign: "middle", lineColor: [180, 180, 180], lineWidth: 0.18 },
          headStyles: { fillColor: PDF_BLUE, textColor: 255, halign: "center", fontStyle: "bold", cellPadding: 1.6 * zoom },
          footStyles: { fillColor: PDF_BLUE_LIGHT, textColor: 20, fontStyle: "bold", halign: "center" },
          didParseCell: blueCol0,
          margin: { left: marginLeft, right: 10, top: HEADER_H + 3, bottom: 12 },
          theme: "grid",
          tableWidth: "wrap",
          rowPageBreak: "avoid",
          didDrawPage: () => drawHeader(d),
        });
        const afterUniY = (d as any).lastAutoTable.finalY + 8 * zoom;
        d.setFontSize(10 * zoom); d.setFont("helvetica", "bold"); d.setTextColor(20);
        d.text("Resumo Gerencial por Unidade", marginLeft, afterUniY);
        autoTable(d, {
          startY: afterUniY + 2 * zoom,
          head: [uniHeaders],
          body: uniBody,
          foot: [uniFoot],
          styles: { fontSize: fontSize - 0.3, cellPadding: Math.max(padY - 0.2 * zoom, 0.3), halign: "center", valign: "middle", lineColor: [180, 180, 180], lineWidth: 0.18 },
          headStyles: { fillColor: PDF_BLUE, textColor: 255, halign: "center", fontStyle: "bold", cellPadding: 1.6 * zoom },
          footStyles: { fillColor: PDF_BLUE_LIGHT, textColor: 20, fontStyle: "bold", halign: "center" },
          didParseCell: blueCol0,
          margin: { left: marginLeft, right: 10, top: HEADER_H + 3, bottom: 12 },
          theme: "grid",
          tableWidth: "wrap",
          rowPageBreak: "avoid",
          didDrawPage: () => drawHeader(d),
        });

        const afterGrpY = (d as any).lastAutoTable.finalY + 8 * zoom;
        d.setFontSize(10 * zoom); d.setFont("helvetica", "bold"); d.setTextColor(20);
        d.text("Resumo Gerencial por Grupo", marginLeft, afterGrpY);
        autoTable(d, {
          startY: afterGrpY + 2 * zoom,
          head: [grpHeaders],
          body: grpBody,
          foot: [grpFoot],
          styles: { fontSize: fontSize - 0.3, cellPadding: Math.max(padY - 0.2 * zoom, 0.3), halign: "center", valign: "middle", lineColor: [180, 180, 180], lineWidth: 0.18 },
          headStyles: { fillColor: PDF_BLUE, textColor: 255, halign: "center", fontStyle: "bold", cellPadding: 1.6 * zoom },
          footStyles: { fillColor: PDF_BLUE_LIGHT, textColor: 20, fontStyle: "bold", halign: "center" },
          didParseCell: blueCol0,
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
          {mode === "linha" && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none px-2">
              <Switch checked={mostrarDescricao} onCheckedChange={setMostrarDescricao} className="scale-90" />
              Mostrar descrição da linha
            </label>
          )}
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
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none px-2">
            <Switch checked={mostrarCusto} onCheckedChange={setMostrarCusto} className="scale-90" />
            Mostrar custo de mão de obra
          </label>
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

      <Card className="shadow-[var(--shadow-card)] print:hidden">
        <CardContent className="p-3 flex flex-wrap items-center gap-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Campos visíveis</span>
          {RESUMO_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox
                checked={visibleFields.has(f.key)}
                onCheckedChange={() => toggleField(f.key)}
                className="h-3.5 w-3.5"
              />
              {f.label}
            </label>
          ))}
        </CardContent>
      </Card>

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
                {shownFields.map((f) => <td key={f.key}>{f.fmt(r[f.key])}</td>)}
                {comCustoTabela && <td>{fmtMoeda(custoPorGroupKey.get(r.groupKey) ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ textAlign: "left" }}>TOTAL</td>
              {shownFields.map((f) => <td key={f.key}>{f.fmt(totals[f.key])}</td>)}
              {comCustoTabela && <td>{fmtMoeda(Array.from(custoPorGroupKey.values()).reduce((s, v) => s + v, 0))}</td>}
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
                      <TableCell className="px-2 py-1 font-medium">
                        {r.groupLabel}
                        {mostrarDescricao && descricaoPorLinha.get(r.groupKey) && (
                          <span className="block text-[10px] font-normal text-muted-foreground">{descricaoPorLinha.get(r.groupKey)}</span>
                        )}
                      </TableCell>
                      {shownFields.map((f) => (
                        <TableCell key={f.key} className="px-2 py-1 text-right tabular-nums">{f.fmt(r[f.key])}</TableCell>
                      ))}
                      {comCustoTabela && <TableCell className="px-2 py-1 text-right tabular-nums">{fmtMoeda(custoPorGroupKey.get(r.groupKey) ?? 0)}</TableCell>}
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold h-9">
                    <TableCell className="px-2 py-1">TOTAL</TableCell>
                    {shownFields.map((f) => (
                      <TableCell key={f.key} className="px-2 py-1 text-right tabular-nums">{f.fmt(totals[f.key])}</TableCell>
                    ))}
                    {comCustoTabela && <TableCell className="px-2 py-1 text-right tabular-nums">{fmtMoeda(Array.from(custoPorGroupKey.values()).reduce((s, v) => s + v, 0))}</TableCell>}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resumo Gerencial por Empresa / Unidade / Grupo de Linha */}
      <ResumoGerencialTable titulo="Resumo Gerencial por Empresa" rows={resumoEmpresa} keyField="empresa" loading={loading} />
      <ResumoGerencialTable titulo="Resumo Gerencial por Unidade" rows={resumoUnidade} keyField="unidade" loading={loading} />
      <ResumoGerencialTable titulo="Resumo Gerencial por Grupo" rows={resumoGrupoLinha} keyField="grupo" loading={loading} />
      </div>
    </div>
  );
}

type ResumoGerencialRow = { partidas: number; km: number; servicos: number; frota: number; [k: string]: string | number };

function appendResumoSheet(wb: XLSX.WorkBook, nomeAba: string, keyField: string, rows: { [k: string]: string | number; servicos: number; frota: number; partidas: number; km: number }[]) {
  const aoa: (string | number)[][] = [
    [`RESUMO GERENCIAL POR ${nomeAba.toUpperCase()}`],
    [],
    [nomeAba, "Serviços", "Frota", "Partidas", "KM"],
    ...rows.map((r) => [r[keyField], r.servicos, r.frota, r.partidas, roundTo(r.km, 1)]),
    ["TOTAL",
      rows.reduce((s, r) => s + r.servicos, 0),
      rows.reduce((s, r) => s + r.frota, 0),
      rows.reduce((s, r) => s + r.partidas, 0),
      roundTo(rows.reduce((s, r) => s + r.km, 0), 1),
    ],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  ws["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];

  const FILL_BLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE } };
  const FILL_LIGHTBLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE_LIGHT } };
  const THIN = { style: "thin", color: { rgb: "B4B4B4" } };
  const border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  const titleCell = (ws as any)["A1"];
  if (titleCell) titleCell.s = { font: { bold: true, sz: 13, color: { rgb: XLSX_LINE_BLUE } }, alignment: { horizontal: "center" } };
  for (let c = 0; c < 5; c++) {
    const headCell = (ws as any)[XLSX.utils.encode_cell({ r: 2, c })];
    if (headCell) headCell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: FILL_BLUE, alignment: { horizontal: "center" }, border };
    for (let r = 3; r < 3 + rows.length; r++) {
      const cell = (ws as any)[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.s = { font: c === 0 ? { bold: true, color: { rgb: XLSX_LINE_BLUE } } : { color: { rgb: "000000" } }, alignment: { horizontal: "center" }, border };
    }
    const totCell = (ws as any)[XLSX.utils.encode_cell({ r: 3 + rows.length, c })];
    if (totCell) totCell.s = { font: { bold: true, color: { rgb: "000000" } }, fill: FILL_LIGHTBLUE, alignment: { horizontal: "center" }, border };
  }
  XLSX.utils.book_append_sheet(wb, ws, `Resumo ${nomeAba}`.slice(0, 31));
}

function ResumoGerencialTable({ titulo, rows, keyField, loading }: { titulo: string; rows: ResumoGerencialRow[]; keyField: string; loading: boolean }) {
  if (loading || rows.length === 0) return null;
  const comCusto = rows.some((r) => Number(r.custo ?? 0) > 0);
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="px-2 py-1 capitalize">{keyField}</TableHead>
                <TableHead className="px-2 py-1 text-right">Serviços</TableHead>
                <TableHead className="px-2 py-1 text-right">Frota</TableHead>
                <TableHead className="px-2 py-1 text-right">Partidas</TableHead>
                <TableHead className="px-2 py-1 text-right">KM</TableHead>
                {comCusto && <TableHead className="px-2 py-1 text-right">Custo M.O.</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={String(r[keyField])} className="h-8">
                  <TableCell className="px-2 py-1 font-medium">{r[keyField]}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{r.servicos}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{r.frota}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{fmtInt(r.partidas)}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{fmtKm(r.km)}</TableCell>
                  {comCusto && <TableCell className="px-2 py-1 text-right tabular-nums">{fmtMoeda(Number(r.custo ?? 0))}</TableCell>}
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-bold h-9">
                <TableCell className="px-2 py-1">TOTAL</TableCell>
                <TableCell className="px-2 py-1 text-right tabular-nums">{rows.reduce((s, r) => s + r.servicos, 0)}</TableCell>
                <TableCell className="px-2 py-1 text-right tabular-nums">{rows.reduce((s, r) => s + r.frota, 0)}</TableCell>
                <TableCell className="px-2 py-1 text-right tabular-nums">{fmtInt(rows.reduce((s, r) => s + r.partidas, 0))}</TableCell>
                <TableCell className="px-2 py-1 text-right tabular-nums">{fmtKm(rows.reduce((s, r) => s + r.km, 0))}</TableCell>
                {comCusto && <TableCell className="px-2 py-1 text-right tabular-nums">{fmtMoeda(rows.reduce((s, r) => s + Number(r.custo ?? 0), 0))}</TableCell>}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
