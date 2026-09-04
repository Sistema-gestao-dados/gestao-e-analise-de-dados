import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useCallback } from "react";
import { fetchLinhas, fetchKm, fetchMulti, fetchEmpresaEstacao } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import { buildKmMaps, viagemKm, viagemKmResult, fmtKm, fmtInt } from "@/lib/km";
import { buildServiceUnits, dominantLinha, vehicleOrigemLinha, type ViagemLite } from "@/lib/resumo";
import { buildEmpresaOverrideMap, resolveEmpresaViagem, resolveGrupoViagem, buildEmpresaPorServico } from "@/lib/empresa-estacao";
import { buildJornadas } from "@/lib/jornada";
import { fetchProjetosAtivos, filterViagensAtivas } from "@/lib/projeto-ativo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bus, Route as RouteIcon, Building2, Activity, Download, RefreshCw, Layers, MapPinned, Truck, AlertTriangle as AlertTriangleIcon } from "lucide-react";
import { MultiSelect } from "@/components/multi-select";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, Legend, CartesianGrid, LabelList,
} from "recharts";
import { useAuditView } from "@/lib/use-audit-view";
import { usePersistentState } from "@/hooks/use-persistent-state";

export const Route = createFileRoute("/dashboard-operacional")({
  head: () => ({ meta: [{ title: "Dashboard Operacional — Gestão e Análise de Dados" }] }),
  component: DashOperacional,
});

// Paleta moderna estilo neumórfico (cyan → violeta → magenta)
const COLORS = ["#22d3ee", "#38bdf8", "#818cf8", "#a78bfa", "#f472b6", "#f59e0b", "#34d399", "#f43f5e"];
// Pares (topo → base) para gradientes de barras/áreas
const GRADS: Array<[string, string]> = [
  ["#67e8f9", "#0891b2"],
  ["#7dd3fc", "#2563eb"],
  ["#a5b4fc", "#4f46e5"],
  ["#c4b5fd", "#7c3aed"],
  ["#f9a8d4", "#db2777"],
  ["#fde68a", "#d97706"],
  ["#6ee7b7", "#059669"],
  ["#fda4af", "#e11d48"],
];
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));

const CHART_TITLES = [
  "Viagens por Linha",
  "Viagens por Empresa",
  "Viagens por Dia Tipo",
  "KM Total por Linha",
  "Serviço = Motorista",
  "Serviços por Grupo de Linha",
  "Linhas por Categoria",
  "Partidas por Hora",
  "Resumo",
  "Frota por Dia Tipo",
  "Frota por Empresa",
  "KM Total por Dia Tipo",
  "Linhas com Jornadas > 10h",
];

function parseHHMM(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function StatCard({ label, value, icon: Icon, hint, tone = "primary" }: { label: string; value: string | number; icon: any; hint?: string; tone?: "primary" | "success" | "warning" }) {
  const gradients = {
    primary: "from-cyan-500/25 via-sky-500/10 to-indigo-500/25 text-cyan-400",
    success: "from-emerald-500/25 via-teal-500/10 to-cyan-500/25 text-emerald-400",
    warning: "from-fuchsia-500/25 via-rose-500/10 to-amber-500/25 text-fuchsia-400",
  } as const;
  const ring = {
    primary: "ring-cyan-400/30 shadow-[0_0_20px_-4px_hsl(190_90%_55%/0.4)]",
    success: "ring-emerald-400/30 shadow-[0_0_20px_-4px_hsl(160_80%_50%/0.4)]",
    warning: "ring-fuchsia-400/30 shadow-[0_0_20px_-4px_hsl(320_85%_60%/0.4)]",
  } as const;
  return (
    <Card className={`group relative overflow-hidden rounded-2xl border-border/60 bg-gradient-to-br ${gradients[tone]} bg-card/80 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_20px_40px_-20px_hsl(var(--foreground)/0.35)]`}>
      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-white/10 to-transparent blur-2xl" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      <CardContent className="relative p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">{value}</p>
            {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
          </div>
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center ring-1 shrink-0 bg-background/40 backdrop-blur ${ring[tone]}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function exportCSV(name: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(";"), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(";"))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function ChartCard({ title, badge, onExport, children }: { title: string; badge?: string; onExport?: () => void; children: React.ReactNode }) {
  return (
    <Card className="relative overflow-hidden rounded-2xl border-border/60 bg-gradient-to-br from-card to-card/70 shadow-[0_1px_0_0_hsl(var(--foreground)/0.04)_inset,0_20px_40px_-24px_hsl(var(--foreground)/0.25)] backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[13px] font-semibold tracking-tight flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-br from-cyan-400 to-fuchsia-500 shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
            {title}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {badge && <Badge variant="outline" className="text-[10px] border-border/60 bg-background/50 backdrop-blur">{badge}</Badge>}
            {onExport && (
              <Button variant="ghost" size="icon" className="h-7 w-7 opacity-60 hover:opacity-100" onClick={onExport} title="Exportar CSV">
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  );
}

const tooltipStyle = {
  background: "color-mix(in oklab, var(--popover) 85%, transparent)",
  border: "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 10px 30px -10px hsl(var(--foreground) / 0.35)",
  backdropFilter: "blur(8px)",
} as const;

// Defs SVG compartilhadas: gradientes de barras/áreas + glow para donuts
function ChartDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        {GRADS.map(([a, b], i) => (
          <linearGradient key={`bar-v-${i}`} id={`bar-v-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={a} stopOpacity={1} />
            <stop offset="100%" stopColor={b} stopOpacity={0.85} />
          </linearGradient>
        ))}
        {GRADS.map(([a, b], i) => (
          <linearGradient key={`bar-h-${i}`} id={`bar-h-${i}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={b} stopOpacity={0.85} />
            <stop offset="100%" stopColor={a} stopOpacity={1} />
          </linearGradient>
        ))}
        <linearGradient id="grad-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.15} />
        </linearGradient>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
    </svg>
  );
}

// Donut moderno com total no centro (semelhante às refs)
function DonutCenter({ total, label }: { total: number | string; label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums bg-gradient-to-br from-cyan-300 to-fuchsia-400 bg-clip-text text-transparent">
        {typeof total === "number" ? total.toLocaleString("pt-BR") : total}
      </div>
    </div>
  );
}

function DashOperacional() {
  useAuditView("dashboard_operacional");
  const qc = useQueryClient();
  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const kmQ = useQuery({ queryKey: ["km"], queryFn: fetchKm });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const empresaEstacaoQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });

  const viagensRaw = viagensQ.data ?? [];
  const ativos = ativosQ.data ?? [];
  const [somenteAtivos, setSomenteAtivos] = usePersistentState("dashboard.somenteAtivos", true);
  const viagens = useMemo(
    () => (somenteAtivos ? filterViagensAtivas(viagensRaw, ativos) : viagensRaw),
    [viagensRaw, ativos, somenteAtivos],
  );
  const linhas = linhasQ.data ?? [];
  const km = kmQ.data ?? [];
  const multi = multiQ.data ?? [];
  const empresaEstacao = empresaEstacaoQ.data ?? [];

  // Lookups
  const linhaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l])), [linhas]);
  const empresaOverrideMap = useMemo(() => buildEmpresaOverrideMap(empresaEstacao), [empresaEstacao]);

  // KM maps: trecho exato ou reverso; trecho ausente vale zero e gera alerta.
  const kmMaps = useMemo(() => buildKmMaps(km), [km]);

  // Grupo lookup: linha+tipo_dia -> grupo
  const grupoMap = useMemo(() => {
    const m = new Map<string, string>();
    multi.forEach((mu) => {
      m.set(`${mu.linha}|${mu.tipo_dia}`.toLowerCase(), mu.grupo_du);
    });
    return m;
  }, [multi]);

  // Show values preference (persisted)
  const [showValues, setShowValues] = usePersistentState("dashboard.showValues", true);

  // Seleção individual de quais gráficos ficam visíveis (persistida).
  // Segue a mesma semântica do MultiSelect: vazio = todos visíveis;
  // selecionar itens específicos mostra SOMENTE esses.
  const [visibleCharts, setVisibleCharts] = usePersistentState<string[]>("dashboard.visibleCharts", []);
  const isVisible = useCallback(
    (title: string) => visibleCharts.length === 0 || visibleCharts.includes(title),
    [visibleCharts],
  );

  // Filters
  const [fPeriodo, setFPeriodo] = usePersistentState("dashboard.fPeriodo", "__all");
  const [fDia, setFDia] = usePersistentState("dashboard.fDia", "__all");
  const [fEmpresa, setFEmpresa] = usePersistentState("dashboard.fEmpresa", "__all");
  const [fUnidade, setFUnidade] = usePersistentState("dashboard.fUnidade", "__all");
  const [fGrupoOrdem, setFGrupoOrdem] = usePersistentState("dashboard.fGrupoOrdem", "__all");
  const [fLinha, setFLinha] = usePersistentState<string[]>("dashboard.fLinha", []);
  const linhaSet = useMemo(() => new Set(fLinha), [fLinha]);
  const [fCategoria, setFCategoria] = usePersistentState("dashboard.fCategoria", "__all");
  const [fGrupo, setFGrupo] = usePersistentState("dashboard.fGrupo", "__all");
  const [fTipoServ, setFTipoServ] = usePersistentState("dashboard.fTipoServ", "__all");
  const [fSentido, setFSentido] = usePersistentState("dashboard.fSentido", "__all");
  const [fFaixa, setFFaixa] = usePersistentState("dashboard.fFaixa", "__all");
  const [fOrigem, setFOrigem] = usePersistentState("dashboard.fOrigem", "__all");
  const [fDestino, setFDestino] = usePersistentState("dashboard.fDestino", "__all");
  const [fTipoMov, setFTipoMov] = usePersistentState("dashboard.fTipoMov", "__all"); // Soltura/Comercial/Recolha
  const [fCatMov, setFCatMov] = usePersistentState("dashboard.fCatMov", "__all"); // Deslocamento/Viagem
  const [fTurno, setFTurno] = usePersistentState("dashboard.fTurno", "__all");

  // Distinct options
  const opts = useMemo(() => {
    const set = (fn: (v: ViagemLite) => string | null | undefined) =>
      Array.from(new Set(viagens.map(fn).filter(Boolean) as string[])).sort();
    return {
      dia: set((v) => v.tipo_operacao),
      empresa: Array.from(new Set([
        ...linhas.map((l) => l.empresa).filter(Boolean) as string[],
        ...empresaEstacao.map((e) => e.empresa).filter(Boolean),
      ])).sort(),
      unidade: Array.from(new Set(linhas.map((l) => l.unidade).filter(Boolean) as string[])).sort(),
      grupoOrdem: Array.from(new Set([
        ...linhas.map((l) => l.ordem).filter(Boolean) as string[],
        ...empresaEstacao.map((e) => e.grupo).filter(Boolean) as string[],
      ])).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
      linha: set((v) => v.linha),
      categoria: Array.from(new Set(linhas.map((l) => l.categoria).filter(Boolean) as string[])).sort(),
      grupo: Array.from(new Set(multi.map((m) => m.grupo_du).filter(Boolean))).sort(),
      tipoServ: set((v) => v.tipo_servico),
      sentido: set((v) => v.sentido),
      origem: set((v) => v.origem),
      destino: set((v) => v.destino),
      tipoMov: set((v) => v.tipo_movimento),
      catMov: set((v) => v.categoria_movimento),
      turno: set((v) => v.turno),
    };
  }, [viagens, linhas, multi, empresaEstacao]);

  const periodos = [
    { v: "__all", l: "Todo período" },
    { v: "7", l: "Últimos 7 dias" },
    { v: "30", l: "Últimos 30 dias" },
    { v: "90", l: "Últimos 90 dias" },
  ];

  // Apply filters
  const filtered = useMemo(() => {
    const now = Date.now();
    const periodMs = fPeriodo === "__all" ? null : parseInt(fPeriodo, 10) * 86_400_000;
    return viagens.filter((v) => {
      if (periodMs && now - new Date(v.created_at).getTime() > periodMs) return false;
      if (fDia !== "__all" && v.tipo_operacao !== fDia) return false;
      if (linhaSet.size > 0 && !linhaSet.has(v.linha)) return false;
      if (fTipoServ !== "__all" && v.tipo_servico !== fTipoServ) return false;
      if (fSentido !== "__all" && v.sentido !== fSentido) return false;
      if (fOrigem !== "__all" && v.origem !== fOrigem) return false;
      if (fDestino !== "__all" && v.destino !== fDestino) return false;
      if (fTipoMov !== "__all" && v.tipo_movimento !== fTipoMov) return false;
      if (fCatMov !== "__all" && v.categoria_movimento !== fCatMov) return false;
      if (fTurno !== "__all" && v.turno !== fTurno) return false;
      const l = linhaMap.get(v.linha);
      if (fEmpresa !== "__all" && resolveEmpresaViagem(v, linhaMap, empresaOverrideMap) !== fEmpresa) return false;
      if (fUnidade !== "__all" && l?.unidade !== fUnidade) return false;
      if (fGrupoOrdem !== "__all" && resolveGrupoViagem(v, linhaMap, empresaOverrideMap) !== fGrupoOrdem) return false;
      if (fCategoria !== "__all" && l?.categoria !== fCategoria) return false;
      if (fGrupo !== "__all") {
        const g = grupoMap.get(`${v.linha}|${v.tipo_operacao ?? ""}`.toLowerCase());
        if (g !== fGrupo) return false;
      }
      if (fFaixa !== "__all") {
        const m = parseHHMM(v.partida);
        if (m == null) return false;
        const h = String(Math.floor(m / 60)).padStart(2, "0");
        if (h !== fFaixa) return false;
      }
      return true;
    });
  }, [viagens, fPeriodo, fDia, fLinha, fTipoServ, fSentido, fEmpresa, fUnidade, fGrupoOrdem, fCategoria, fGrupo, fFaixa, fOrigem, fDestino, fTipoMov, fCatMov, fTurno, linhaMap, grupoMap, empresaOverrideMap]);

  // Base dos gráficos = respeita o filtro de Movimento (use o filtro acima para isolar Comercial / Soltura / Recolha).
  const comerciais = filtered;

  // KM helper: soma trecho exato/reverso; cadastro ausente não inventa média.
  const kmTotal = useMemo(() => {
    let total = 0;
    filtered.forEach((v) => { total += viagemKm(v, kmMaps); });
    return total;
  }, [filtered, kmMaps]);

  // Unidades de serviço — MESMA função usada no Resumo Operacional / Resumo por
  // Linha, garantindo que "Serviços" e "Frota" aqui batam com os outros relatórios.
  const units = useMemo(
    () => buildServiceUnits(filtered as unknown as ViagemLite[], (v) => viagemKm(v as any, kmMaps)),
    [filtered, kmMaps],
  );

  // Linha de origem por veículo (mesma regra oficial de Frota do Resumo por Linha)
  const origemPorVeiculo = useMemo(
    () => vehicleOrigemLinha(filtered as unknown as ViagemLite[]),
    [filtered],
  );

  // Empresa por veículo/serviço — resolve exceções de linha com mais de uma
  // empresa (por estação de origem/destino) antes de cair na empresa fixa.
  const empresaPorServico = useMemo(
    () => buildEmpresaPorServico(filtered, linhaMap, empresaOverrideMap),
    [filtered, linhaMap, empresaOverrideMap],
  );

  // versão de programação -> dia tipo (cada versão pertence a um único dia tipo)
  const versaoParaDia = useMemo(() => {
    const m = new Map<string, string>();
    filtered.forEach((v) => {
      if (v.versao_programacao && v.tipo_operacao && !m.has(v.versao_programacao)) {
        m.set(v.versao_programacao, v.tipo_operacao);
      }
    });
    return m;
  }, [filtered]);

  // KPIs
  const kpis = useMemo(() => {
    const linhasUnicas = new Set(comerciais.map((v) => v.linha));
    const empresasUnicas = new Set(comerciais.map((v) => resolveEmpresaViagem(v, linhaMap, empresaOverrideMap)).filter(Boolean));
    const veiculos = new Set(Array.from(units.values()).map((u) => u.vehicleKey));
    return {
      viagens: comerciais.length,
      servicos: units.size,
      frota: veiculos.size,
      linhas: linhasUnicas.size,
      empresas: empresasUnicas.size,
      kmTot: kmTotal,
      partidas: comerciais.filter((v) => (v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL" && v.partida).length,
    };
  }, [comerciais, linhaMap, kmTotal, units, empresaOverrideMap]);

  // Charts (Top 10)
  const TOP = 10;

  const comPorLinha = useMemo(() => {
    const m = new Map<string, number>();
    comerciais.forEach((v) => m.set(v.linha, (m.get(v.linha) ?? 0) + 1));
    return Array.from(m, ([linha, qtd]) => ({ linha, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, TOP);
  }, [comerciais]);

  const comPorEmpresa = useMemo(() => {
    const m = new Map<string, number>();
    comerciais.forEach((v) => {
      const e = resolveEmpresaViagem(v, linhaMap, empresaOverrideMap) || "Sem empresa";
      m.set(e, (m.get(e) ?? 0) + 1);
    });
    return Array.from(m, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, TOP);
  }, [comerciais, linhaMap, empresaOverrideMap]);

  // Regra: apenas viagens comerciais
  const porDiaTipo = useMemo(() => {
    const ordem = ["Dias úteis", "Sábado", "Domingo"];
    const m = new Map<string, number>();
    comerciais.forEach((v) => { if (v.tipo_operacao) m.set(v.tipo_operacao, (m.get(v.tipo_operacao) ?? 0) + 1); });
    return ordem.filter((d) => m.has(d)).map((dia) => ({ dia, qtd: m.get(dia)! }));
  }, [comerciais]);

  // KM por linha = soma de km com fallback
  const kmPorLinhaChart = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((v) => {
      const k = viagemKm(v, kmMaps);
      if (k > 0) m.set(v.linha, (m.get(v.linha) ?? 0) + k);
    });
    return Array.from(m, ([linha, kmv]) => ({ linha, km: Number(kmv.toFixed(1)) }))
      .sort((a, b) => b.km - a.km).slice(0, TOP);
  }, [filtered, kmMaps]);

  const kmSemCadastro = useMemo(
    () => filtered.filter((v) => viagemKmResult(v, kmMaps).fonte === "sem_cadastro").length,
    [filtered, kmMaps],
  );

  const ORDEM_DIA = ["Dias úteis", "Sábado", "Domingo"];

  // "Serviço = Motorista": 1 unidade de serviço (DIR T1/T2/APROV ou TU) = 1
  // motorista/turno. Mesma contagem usada no KPI "Serviços" e no Resumo por
  // Linha — corrige a divergência entre gráfico e cards.
  const servPorDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of units.values()) {
      const dia = u.tipo_operacao || versaoParaDia.get(u.versao);
      if (!dia) continue;
      m.set(dia, (m.get(dia) ?? 0) + 1);
    }
    return ORDEM_DIA.filter((d) => m.has(d)).map((dia) => ({ dia, servicos: m.get(dia)! }));
  }, [units, versaoParaDia]);

  // Frota por Dia Tipo: veículos físicos distintos (vehicleKey) por dia tipo.
  const frotaPorDiaTipo = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const u of units.values()) {
      const dia = u.tipo_operacao || versaoParaDia.get(u.versao);
      if (!dia) continue;
      if (!m.has(dia)) m.set(dia, new Set());
      m.get(dia)!.add(u.vehicleKey);
    }
    return ORDEM_DIA.filter((d) => m.has(d)).map((dia) => ({ dia, frota: m.get(dia)!.size }));
  }, [units, versaoParaDia]);

  // Frota por Empresa: cada veículo conta 1x, na empresa da sua linha de
  // origem (mesma regra oficial usada no Resumo por Linha).
  const frotaPorEmpresa = useMemo(() => {
    const porEmpresa = new Map<string, Set<string>>();
    for (const [vehicleKey, linha] of origemPorVeiculo) {
      const empresa = empresaPorServico.get(vehicleKey) || linhaMap.get(linha)?.empresa || "Sem empresa";
      if (!porEmpresa.has(empresa)) porEmpresa.set(empresa, new Set());
      porEmpresa.get(empresa)!.add(vehicleKey);
    }
    return Array.from(porEmpresa, ([name, set]) => ({ name, value: set.size }))
      .sort((a, b) => b.value - a.value).slice(0, TOP);
  }, [origemPorVeiculo, linhaMap, empresaPorServico]);

  // KM total por Dia Tipo (soma do km já calculado por unidade de serviço).
  const kmPorDiaTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of units.values()) {
      const dia = u.tipo_operacao || versaoParaDia.get(u.versao);
      if (!dia) continue;
      m.set(dia, (m.get(dia) ?? 0) + u.kmTotal);
    }
    return ORDEM_DIA.filter((d) => m.has(d)).map((dia) => ({ dia, km: Number((m.get(dia) ?? 0).toFixed(1)) }));
  }, [units, versaoParaDia]);

  // Linhas com jornadas acima de 9h (crítico) — empilhado por dia tipo,
  // usando o mesmo cálculo da tela "Jornada de Trabalho".
  const jornada9hDias = useMemo(() => {
    const s = new Set<string>();
    const js = buildJornadas(filtered as unknown as ViagemLite[], linhas);
    js.forEach((j) => { if (j.acimaDe9h) s.add(versaoParaDia.get(j.versao) || "Sem dia tipo"); });
    const ord = ["Dias úteis", "Sábado", "Domingo"];
    return Array.from(s).sort((a, b) => {
      const ia = ord.indexOf(a), ib = ord.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [filtered, linhas, versaoParaDia]);

  const linhasJornada9h = useMemo(() => {
    const js = buildJornadas(filtered as unknown as ViagemLite[], linhas);
    const m = new Map<string, Record<string, number> & { __total: number }>();
    js.forEach((j) => {
      if (!j.acimaDe9h) return;
      const dia = versaoParaDia.get(j.versao) || "Sem dia tipo";
      if (!m.has(j.linha)) m.set(j.linha, { __total: 0 } as any);
      const row = m.get(j.linha)!;
      row[dia] = (row[dia] ?? 0) + 1;
      row.__total += 1;
    });
    return Array.from(m, ([linha, row]) => ({ linha, ...row }))
      .sort((a, b) => b.__total - a.__total)
      .slice(0, 20);
  }, [filtered, linhas, versaoParaDia]);

  // Resumo (KPIs) desmembrado por dia tipo — para o card "Resumo"
  const resumoPorDia = useMemo(() => {
    type Agg = { viagens: number; km: number; frota: Set<string>; servicos: number };
    const m = new Map<string, Agg>();
    const ensure = (d: string) => {
      if (!m.has(d)) m.set(d, { viagens: 0, km: 0, frota: new Set(), servicos: 0 });
      return m.get(d)!;
    };
    comerciais.forEach((v) => {
      const d = v.tipo_operacao || "Sem dia tipo";
      ensure(d).viagens += 1;
    });
    for (const u of units.values()) {
      const d = u.tipo_operacao || versaoParaDia.get(u.versao) || "Sem dia tipo";
      const a = ensure(d);
      a.km += u.kmTotal;
      a.frota.add(u.vehicleKey);
      a.servicos += 1;
    }
    const order = ["Dias úteis", "Sábado", "Domingo"];
    return Array.from(m, ([dia, a]) => ({ dia, viagens: a.viagens, km: a.km, frota: a.frota.size, servicos: a.servicos }))
      .sort((a, b) => {
        const ia = order.indexOf(a.dia), ib = order.indexOf(b.dia);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
  }, [comerciais, units, versaoParaDia]);

  const servPorGrupo = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const u of units.values()) {
      const linha = dominantLinha(u);
      const g = grupoMap.get(`${linha}|${u.tipo_operacao}`.toLowerCase()) || "Sem grupo";
      if (!m.has(g)) m.set(g, new Set());
      m.get(g)!.add(u.key);
    }
    return Array.from(m, ([grupo, set]) => ({ grupo, servicos: set.size })).sort((a, b) => b.servicos - a.servicos).slice(0, TOP);
  }, [units, grupoMap]);

  const linhasPorCategoria = useMemo(() => {
    const linhasFiltradas = new Set(comerciais.map((v) => v.linha));
    const m = new Map<string, number>();
    linhasFiltradas.forEach((ln) => {
      const c = linhaMap.get(ln)?.categoria || "N/D";
      m.set(c, (m.get(c) ?? 0) + 1);
    });
    return Array.from(m, ([name, value]) => ({ name, value }));
  }, [comerciais, linhaMap]);

  // Partidas por hora exata (00..23)
  const partidasHora = useMemo(() => {
    const m = new Map<string, number>(HOURS.map((h) => [h, 0]));
    comerciais.forEach((v) => {
      const min = parseHHMM(v.partida);
      if (min == null) return;
      const h = String(Math.floor(min / 60)).padStart(2, "0");
      m.set(h, (m.get(h) ?? 0) + 1);
    });
    return HOURS.map((h) => ({ hora: `${h}h`, qtd: m.get(h) ?? 0 }));
  }, [comerciais]);

  const isLoading = viagensQ.isLoading || linhasQ.isLoading;
  const empty = !isLoading && filtered.length === 0;

  const refresh = useCallback(() => { qc.invalidateQueries(); }, [qc]);

  // Label formatter for charts
  const labelProps = showValues ? { fill: "var(--foreground)", fontSize: 10 } : undefined;

  return (
    <div className="relative space-y-5 animate-in fade-in duration-500">
      <ChartDefs />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-60 [background:radial-gradient(1200px_600px_at_10%_-10%,hsl(190_90%_55%/0.08),transparent),radial-gradient(1000px_500px_at_100%_0%,hsl(280_90%_60%/0.08),transparent)]" />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard Operacional</h1>
          <p className="text-sm text-muted-foreground mt-1">Análise consolidada das viagens importadas (GPS).</p>
        </div>
        <div className="flex items-center gap-3">
          <MultiSelect label="Gráficos" values={visibleCharts} onChange={setVisibleCharts} options={CHART_TITLES} placeholder="Todos" />
          <div className="flex items-center gap-2">
            <Switch id="showvals" checked={showValues} onCheckedChange={setShowValues} />
            <Label htmlFor="showvals" className="text-xs cursor-pointer">Mostrar valores</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="somente-ativos" checked={somenteAtivos} onCheckedChange={setSomenteAtivos} />
            <Label htmlFor="somente-ativos" className="text-xs cursor-pointer">Somente ativos</Label>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Badge variant="secondary" className="gap-1.5 h-9 px-3">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> {viagens.length.toLocaleString("pt-BR")} registros
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7 gap-2">
            {[
              { label: "Período", value: fPeriodo, set: setFPeriodo, options: periodos.map((p) => ({ v: p.v, l: p.l })) },
              { label: "Dia Tipo", value: fDia, set: setFDia, options: [{ v: "__all", l: "Todos" }, ...opts.dia.map((x) => ({ v: x, l: x }))] },
              { label: "Empresa", value: fEmpresa, set: setFEmpresa, options: [{ v: "__all", l: "Todas" }, ...opts.empresa.map((x) => ({ v: x, l: x }))] },
              { label: "Unidade", value: fUnidade, set: setFUnidade, options: [{ v: "__all", l: "Todas" }, ...opts.unidade.map((x) => ({ v: x, l: x }))] },
              { label: "Grupo", value: fGrupoOrdem, set: setFGrupoOrdem, options: [{ v: "__all", l: "Todos" }, ...opts.grupoOrdem.map((x) => ({ v: x, l: x }))] },
              { label: "Categoria", value: fCategoria, set: setFCategoria, options: [{ v: "__all", l: "Todas" }, ...opts.categoria.map((x) => ({ v: x, l: x }))] },
              { label: "Grupo de Linha", value: fGrupo, set: setFGrupo, options: [{ v: "__all", l: "Todos" }, ...opts.grupo.map((x) => ({ v: x, l: x }))] },
              { label: "Tipo Serv.", value: fTipoServ, set: setFTipoServ, options: [{ v: "__all", l: "Todos" }, ...opts.tipoServ.map((x) => ({ v: x, l: x }))] },
              { label: "Sentido", value: fSentido, set: setFSentido, options: [{ v: "__all", l: "Todos" }, ...opts.sentido.map((x) => ({ v: x, l: x }))] },
              { label: "Faixa Hr.", value: fFaixa, set: setFFaixa, options: [{ v: "__all", l: "Todas" }, ...HOURS.map((h) => ({ v: h, l: `${h}h` }))] },
              { label: "Origem", value: fOrigem, set: setFOrigem, options: [{ v: "__all", l: "Todas" }, ...opts.origem.map((x) => ({ v: x, l: x }))] },
              { label: "Destino", value: fDestino, set: setFDestino, options: [{ v: "__all", l: "Todos" }, ...opts.destino.map((x) => ({ v: x, l: x }))] },
              { label: "Movimento", value: fTipoMov, set: setFTipoMov, options: [{ v: "__all", l: "Todos" }, ...opts.tipoMov.map((x) => ({ v: x, l: x }))] },
              { label: "Tipo Viagem", value: fCatMov, set: setFCatMov, options: [{ v: "__all", l: "Todos" }, ...opts.catMov.map((x) => ({ v: x, l: x }))] },
              { label: "Turno", value: fTurno, set: setFTurno, options: [{ v: "__all", l: "Todos" }, ...opts.turno.map((x) => ({ v: x, l: x }))] },
            ].map((f) => (
              <div key={f.label} className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{f.label}</label>
                <Select value={f.value} onValueChange={f.set}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {f.options.map((o) => <SelectItem key={o.v} value={o.v} className="text-xs">{o.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <MultiSelect label="Linha" values={fLinha} onChange={setFLinha} options={opts.linha} placeholder="Todas" />

          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">

        <StatCard label="Partidas" value={kpis.partidas.toLocaleString("pt-BR")} icon={Activity} tone="primary" />
        <StatCard label="Serviços" value={kpis.servicos.toLocaleString("pt-BR")} icon={Layers} tone="primary" />
        <StatCard label="Frota" value={kpis.frota.toLocaleString("pt-BR")} icon={Truck} tone="warning" />
        <StatCard label="Linhas" value={kpis.linhas.toLocaleString("pt-BR")} icon={RouteIcon} tone="success" />
        <StatCard label="Empresas" value={kpis.empresas.toLocaleString("pt-BR")} icon={Building2} tone="success" />
        <StatCard label="KM Operado" value={fmtKm(kpis.kmTot)} icon={MapPinned} tone="warning" />
      </div>

      {kmSemCadastro > 0 && (
        <div className="w-full rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2">
          <AlertTriangleIcon className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <span className="text-xs"><strong>{kmSemCadastro.toLocaleString("pt-BR")}</strong> viagem(ns) estão sem trecho de KM cadastrado e entram como 0 km. O sistema não usa mais média estimada.</span>
        </div>
      )}

      {empty && (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Nenhuma viagem encontrada com os filtros aplicados.</p>
          </CardContent>
        </Card>
      )}

      {!empty && (
        <>
          {/* Row 1 */}
          <div className="grid lg:grid-cols-3 gap-4">
            {isVisible("Viagens por Linha") && (
            <ChartCard title="Viagens por Linha" badge="Top 10" onExport={() => exportCSV("viagens-por-linha", comPorLinha)}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={comPorLinha} margin={{ top: 20, right: 8, left: -16, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="linha" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} interval={0} angle={-45} textAnchor="end" />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="qtd" fill="url(#bar-v-0)" radius={[4, 4, 0, 0]}>
                    {showValues && <LabelList dataKey="qtd" position="top" {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("Viagens por Empresa") && (
            <ChartCard title="Viagens por Empresa" badge="Top 10" onExport={() => exportCSV("viagens-por-empresa", comPorEmpresa)}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={comPorEmpresa} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--foreground)" }} width={110} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="value" fill="url(#bar-v-1)" radius={[0, 6, 6, 0]}>
                    {showValues && <LabelList dataKey="value" position="right" {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("Viagens por Dia Tipo") && (
            <ChartCard title="Viagens por Dia Tipo" onExport={() => exportCSV("viagens-por-dia-tipo", porDiaTipo)}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={porDiaTipo} margin={{ top: 20, right: 8, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="qtd" radius={[6, 6, 0, 0]}>
                    {porDiaTipo.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    {showValues && <LabelList dataKey="qtd" position="top" {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}
          </div>

          {/* Row 2 */}
          <div className="grid lg:grid-cols-3 gap-4">
            {isVisible("KM Total por Linha") && (
            <ChartCard title="KM Total por Linha" badge="Top 10" onExport={() => exportCSV("km-total-por-linha", kmPorLinhaChart)}>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={kmPorLinhaChart} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis type="category" dataKey="linha" tick={{ fontSize: 10, fill: "var(--foreground)" }} width={70} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} formatter={(v: any) => [`${fmtKm(Number(v))} km`, "KM"]} />
                  <Bar dataKey="km" fill="url(#bar-v-2)" radius={[0, 6, 6, 0]}>
                    {showValues && <LabelList dataKey="km" position="right" {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("Serviço = Motorista") && (
            <ChartCard title="Serviço = Motorista" onExport={() => exportCSV("servico-motorista", servPorDia)}>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={servPorDia} margin={{ top: 20, right: 8, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="servicos" fill="url(#bar-v-3)" radius={[6, 6, 0, 0]}>
                    {showValues && <LabelList dataKey="servicos" position="top" {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("Serviços por Grupo de Linha") && (
            <ChartCard title="Serviços por Grupo de Linha" badge="Top 10" onExport={() => exportCSV("servicos-por-grupo", servPorGrupo)}>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={servPorGrupo} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis type="category" dataKey="grupo" tick={{ fontSize: 10, fill: "var(--foreground)" }} width={90} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="servicos" fill="url(#bar-v-6)" radius={[0, 6, 6, 0]}>
                    {showValues && <LabelList dataKey="servicos" position="right" {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}
          </div>

          {/* Row 3 */}
          <div className="grid lg:grid-cols-3 gap-4">
            {isVisible("Linhas por Categoria") && (
            <ChartCard title="Linhas por Categoria" onExport={() => exportCSV("linhas-categoria", linhasPorCategoria)}>
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie filter="url(#glow)" data={linhasPorCategoria} dataKey="value" nameKey="name" outerRadius={110} innerRadius={60} paddingAngle={2} stroke="var(--background)" strokeWidth={2}
                    label={showValues ? ({ value }) => String(value) : false} labelLine={showValues}>
                    {linhasPorCategoria.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("Partidas por Hora") && (
            <ChartCard title="Partidas por Hora" badge="00h–23h" onExport={() => exportCSV("partidas-por-hora", partidasHora)}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={partidasHora} margin={{ top: 20, right: 8, left: -16, bottom: 20 }}>
                  <defs>
                    <linearGradient id="grad-hora" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS[0]} stopOpacity={1} />
                      <stop offset="100%" stopColor={COLORS[0]} stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="hora" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} interval={0} angle={-45} textAnchor="end" />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="qtd" fill="url(#grad-hora)" radius={[4, 4, 0, 0]}>
                    {showValues && <LabelList dataKey="qtd" position="top" {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("Resumo") && (
            <ChartCard title="Resumo" badge={resumoPorDia.length ? `${resumoPorDia.length} dia(s) tipo` : undefined}>
              <div className="grid grid-cols-2 gap-2 text-sm py-2">
                <div className="rounded-lg border border-border p-2.5">
                  <div className="text-[10px] uppercase text-muted-foreground">Viagens</div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">{kpis.viagens.toLocaleString("pt-BR")}</div>
                </div>
                <div className="rounded-lg border border-border p-2.5">
                  <div className="text-[10px] uppercase text-muted-foreground">Frota</div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">{kpis.frota.toLocaleString("pt-BR")}</div>
                </div>
                <div className="rounded-lg border border-border p-2.5">
                  <div className="text-[10px] uppercase text-muted-foreground">KM total</div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">{fmtKm(kpis.kmTot)}</div>
                </div>
                <div className="rounded-lg border border-border p-2.5">
                  <div className="text-[10px] uppercase text-muted-foreground">Linhas</div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">{kpis.linhas.toLocaleString("pt-BR")}</div>
                </div>
              </div>
              {resumoPorDia.length > 0 && (
                <div className="mt-2 rounded-lg border border-border/60 overflow-hidden">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40 px-2.5 py-1.5">Por dia tipo</div>
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border/60">
                        <th className="text-left font-medium px-2.5 py-1.5">Dia</th>
                        <th className="text-right font-medium px-2 py-1.5">Viagens</th>
                        <th className="text-right font-medium px-2 py-1.5">Serviços</th>
                        <th className="text-right font-medium px-2 py-1.5">Frota</th>
                        <th className="text-right font-medium px-2.5 py-1.5">KM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumoPorDia.map((r) => (
                        <tr key={r.dia} className="border-b border-border/40 last:border-0">
                          <td className="px-2.5 py-1.5 font-medium">{r.dia}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.viagens.toLocaleString("pt-BR")}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.servicos.toLocaleString("pt-BR")}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.frota.toLocaleString("pt-BR")}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums">{fmtKm(r.km)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ChartCard>
            )}
          </div>

          {/* Row 4 — Frota, KM por dia tipo e jornadas críticas (fonte única: lib/resumo.ts e lib/jornada.ts) */}
          <div className="grid lg:grid-cols-2 gap-4">
            {isVisible("Frota por Dia Tipo") && (
            <ChartCard title="Frota por Dia Tipo" onExport={() => exportCSV("frota-por-dia-tipo", frotaPorDiaTipo)}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={frotaPorDiaTipo} margin={{ top: 20, right: 8, left: -16 }}>
                  <defs>
                    {frotaPorDiaTipo.map((_, i) => (
                      <linearGradient key={i} id={`grad-frota-dia-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={1} />
                        <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.55} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} formatter={(v: any) => [`${fmtInt(Number(v))} veículo(s)`, "Frota"]} />
                  <Bar dataKey="frota" radius={[8, 8, 0, 0]}>
                    {frotaPorDiaTipo.map((_, i) => <Cell key={i} fill={`url(#grad-frota-dia-${i})`} />)}
                    {showValues && <LabelList dataKey="frota" position="top" {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("Frota por Empresa") && (
            <ChartCard title="Frota por Empresa" badge="Top 10" onExport={() => exportCSV("frota-por-empresa", frotaPorEmpresa)}>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie filter="url(#glow)" data={frotaPorEmpresa} dataKey="value" nameKey="name" outerRadius={110} innerRadius={62} paddingAngle={3} stroke="var(--background)" strokeWidth={2}
                    label={showValues ? ({ value }) => String(value) : false} labelLine={showValues}>
                    {frotaPorEmpresa.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [`${fmtInt(Number(v))} veículo(s)`, n]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("KM Total por Dia Tipo") && (
            <ChartCard title="KM Total por Dia Tipo" onExport={() => exportCSV("km-por-dia-tipo", kmPorDiaTipo)}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={kmPorDiaTipo} margin={{ top: 20, right: 8, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} formatter={(v: any) => [`${fmtKm(Number(v))} km`, "KM"]} />
                  <Bar dataKey="km" radius={[8, 8, 0, 0]}>
                    {kmPorDiaTipo.map((_, i) => <Cell key={i} fill={COLORS[(i + 4) % COLORS.length]} />)}
                    {showValues && <LabelList dataKey="km" position="top" formatter={(v: any) => fmtKm(Number(v))} {...labelProps} />}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            )}

            {isVisible("Linhas com Jornadas > 10h") && (
            <ChartCard title="Linhas com Jornadas > 10h" badge={`Crítico · ${linhasJornada9h.length} linha(s)`} onExport={() => exportCSV("linhas-jornada-9h", linhasJornada9h)}>
              {linhasJornada9h.length === 0 ? (
                <div className="h-[300px] flex flex-col items-center justify-center text-center text-muted-foreground gap-2">
                  <AlertTriangleIcon className="h-8 w-8 opacity-40" />
                  <p className="text-sm">Nenhuma linha com jornada acima de 10h para os filtros atuais.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(300, linhasJornada9h.length * 26 + 60)}>
                  <BarChart data={linhasJornada9h} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                    <YAxis type="category" dataKey="linha" tick={{ fontSize: 10, fill: "var(--foreground)" }} width={90} interval={0} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} formatter={(v: any, n: any) => [`${fmtInt(Number(v))} serviço(s)`, n]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    {jornada9hDias.map((dia, i) => (
                      <Bar key={dia} dataKey={dia} stackId="j9" fill={COLORS[i % COLORS.length]} radius={i === jornada9hDias.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0]}>
                        {showValues && i === jornada9hDias.length - 1 && (
                          <LabelList dataKey="__total" position="right" {...labelProps} />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}
