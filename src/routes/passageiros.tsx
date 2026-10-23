import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { fetchLinhas, type Linha } from "@/lib/data";
import {
  fetchPassageiros, fetchMesesImportados, somar, indicadores, periodoDe, diaSemana, addDias, difDias,
  variacao, fmtNum, fmtReais, type PassageiroDia, type Granularidade, type Totais,
} from "@/lib/passageiros";
import { useAuditView } from "@/lib/use-audit-view";
import { logAudit } from "@/lib/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MultiSelect } from "@/components/multi-select";
import { Checkbox } from "@/components/ui/checkbox";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from "recharts";
import { Users, Ticket, DollarSign, Bus, Route as RouteIcon, Gauge, Percent, Loader2, Download, FileUp, type LucideIcon } from "lucide-react";

export const Route = createFileRoute("/passageiros")({
  head: () => ({ meta: [{ title: "Passageiros e Receita — Gestão e Análise de Dados" }] }),
  component: PassageirosPage,
});

// ---------------------------------------------------------------------------
// Métricas exibidas (somadas + derivadas)
// ---------------------------------------------------------------------------

type ColKey = "transportados" | "pagantes" | "gratuidades" | "receita" | "viagens" | "km"
  | "paxPorViagem" | "ipk" | "tarifaMedia" | "pctGratuidade";

const COLS: { key: ColKey; label: string; curto: string; fmt: (v: number | null) => string; soma: boolean }[] = [
  { key: "transportados", label: "Transportados", curto: "Transp.", fmt: (v) => fmtNum(v), soma: true },
  { key: "pagantes", label: "Pagantes", curto: "Pagantes", fmt: (v) => fmtNum(v), soma: true },
  { key: "gratuidades", label: "Gratuidades", curto: "Gratuid.", fmt: (v) => fmtNum(v), soma: true },
  { key: "receita", label: "Receita", curto: "Receita", fmt: fmtReais, soma: true },
  { key: "viagens", label: "Viagens Realizadas", curto: "Viagens", fmt: (v) => fmtNum(v), soma: true },
  { key: "km", label: "KM", curto: "KM", fmt: (v) => fmtNum(v), soma: true },
  { key: "paxPorViagem", label: "Passageiros por viagem", curto: "Pax/viagem", fmt: (v) => fmtNum(v, 1), soma: false },
  { key: "ipk", label: "IPK (passageiros por km)", curto: "IPK", fmt: (v) => fmtNum(v, 2), soma: false },
  { key: "tarifaMedia", label: "Tarifa média (receita ÷ pagantes)", curto: "Tarifa méd.", fmt: fmtReais, soma: false },
  { key: "pctGratuidade", label: "% Gratuidade", curto: "% Grat.", fmt: (v) => (v == null ? "—" : `${fmtNum(v, 1)}%`), soma: false },
];
const COL = Object.fromEntries(COLS.map((c) => [c.key, c])) as Record<ColKey, (typeof COLS)[number]>;

function valor(t: Totais, k: ColKey): number | null {
  if (COL[k].soma) return t[k as keyof Totais] as number;
  return indicadores(t)[k as "paxPorViagem" | "ipk" | "tarifaMedia" | "pctGratuidade"];
}

type Dimensao = "linha" | "empresa" | "grupo" | "unidade";
const DIMENSOES: { key: Dimensao; label: string }[] = [
  { key: "linha", label: "Linha" },
  { key: "empresa", label: "Empresa" },
  { key: "grupo", label: "Grupo" },
  { key: "unidade", label: "Unidade" },
];
const SEM_CADASTRO = "(sem cadastro)";
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const CORES = ["#2563eb", "#f59e0b", "#16a34a", "#dc2626", "#7c3aed"];
const fmtData = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function dimValor(r: PassageiroDia, d: Dimensao, linhaMap: Map<string, Linha>): string {
  if (d === "linha") return r.linha;
  const l = linhaMap.get(r.linha);
  const v = d === "empresa" ? l?.empresa : d === "grupo" ? l?.ordem : l?.unidade;
  return v?.trim() || SEM_CADASTRO;
}

function agrupar<K extends string>(rows: PassageiroDia[], chave: (r: PassageiroDia) => K): Map<K, PassageiroDia[]> {
  const m = new Map<K, PassageiroDia[]>();
  for (const r of rows) {
    const k = chave(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

const ordenarCodigo = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

/** "07/08/26"; mesmo mês: "07 a 09/08/26"; mesmo ano: "28/08 a 03/09/26". */
function fmtPeriodoCurto(inicio: string, fim: string): string {
  const dd = (d: string) => d.slice(8, 10), mm = (d: string) => d.slice(5, 7), aa = (d: string) => d.slice(2, 4);
  const cheia = (d: string) => `${dd(d)}/${mm(d)}/${aa(d)}`;
  if (inicio === fim) return cheia(fim);
  if (inicio.slice(0, 7) === fim.slice(0, 7)) return `${dd(inicio)} a ${cheia(fim)}`;
  if (inicio.slice(0, 4) === fim.slice(0, 4)) return `${dd(inicio)}/${mm(inicio)} a ${cheia(fim)}`;
  return `${cheia(inicio)} a ${cheia(fim)}`;
}

// ---------------------------------------------------------------------------
// Ordenação (mesmas opções do Relatório Comparativo)
// ---------------------------------------------------------------------------

type Ordem = "valor" | "padrao" | "unidade";
const SEM_UNIDADE = "Sem unidade";

/** Unidade de cada item da tabela: Linha = Unidade do cadastro; Empresa/
 *  Grupo = a Unidade com mais registros entre as linhas dele. */
function unidadePorItem(rows: PassageiroDia[], dim: Dimensao, linhaMap: Map<string, Linha>): Map<string, string> {
  const cont = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const item = dimValor(r, dim, linhaMap);
    const un = linhaMap.get(r.linha)?.unidade?.trim() || SEM_UNIDADE;
    if (!cont.has(item)) cont.set(item, new Map());
    const m = cont.get(item)!;
    m.set(un, (m.get(un) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [item, m] of cont) out.set(item, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

/** Ordena os itens. "unidade": Unidade, depois (por Linha) Categoria e
 *  Grupo da linha, depois o código — igual ao Relatório Comparativo. */
function ordenarItens<T extends { nome: string }>(
  itens: T[], ordem: Ordem, valorDe: (t: T) => number, unidades: Map<string, string>,
  dim: Dimensao, linhaMap: Map<string, Linha>,
): T[] {
  const porNome = (a: T, b: T) => {
    if ((a.nome === SEM_CADASTRO) !== (b.nome === SEM_CADASTRO)) return a.nome === SEM_CADASTRO ? 1 : -1;
    return ordenarCodigo(a.nome, b.nome);
  };
  return [...itens].sort((a, b) => {
    if (ordem === "valor") return valorDe(b) - valorDe(a) || porNome(a, b);
    if (ordem === "unidade") {
      const ua = unidades.get(a.nome) ?? SEM_UNIDADE, ub = unidades.get(b.nome) ?? SEM_UNIDADE;
      if (ua !== ub) return ua === SEM_UNIDADE ? 1 : ub === SEM_UNIDADE ? -1 : ua.localeCompare(ub, "pt-BR");
      if (dim === "linha") {
        const la = linhaMap.get(a.nome), lb = linhaMap.get(b.nome);
        const ca = la?.categoria ?? "", cb = lb?.categoria ?? "";
        if (ca !== cb) return ca.localeCompare(cb, "pt-BR");
        const ga = la?.ordem ?? "", gb = lb?.ordem ?? "";
        if (ga !== gb) return ga.localeCompare(gb, "pt-BR", { numeric: true, sensitivity: "base" });
      }
    }
    return porNome(a, b);
  });
}

/** Itens já ordenados por Unidade -> blocos consecutivos por Unidade. */
function blocosPorUnidade<T extends { nome: string }>(itens: T[], unidades: Map<string, string>): { unidade: string; itens: T[] }[] {
  const out: { unidade: string; itens: T[] }[] = [];
  for (const it of itens) {
    const un = unidades.get(it.nome) ?? SEM_UNIDADE;
    if (out.at(-1)?.unidade !== un) out.push({ unidade: un, itens: [] });
    out.at(-1)!.itens.push(it);
  }
  return out;
}

function SelectOrdem({ value, onChange }: { value: Ordem; onChange: (v: Ordem) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Ordem)}>
      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="valor">Maior valor (métrica)</SelectItem>
        <SelectItem value="padrao">Ordem padrão</SelectItem>
        <SelectItem value="unidade">Ordenar por Unidade</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Filtros (compartilhados pelas duas abas)
// ---------------------------------------------------------------------------

type Filtros = { empresas: string[]; grupos: string[]; unidades: string[]; linhas: string[]; diasSemana: string[] };
const FILTROS_VAZIOS: Filtros = { empresas: [], grupos: [], unidades: [], linhas: [], diasSemana: [] };

function aplicarFiltros(rows: PassageiroDia[], f: Filtros, linhaMap: Map<string, Linha>): PassageiroDia[] {
  const tem = (arr: string[], v: string) => !arr.length || arr.includes(v);
  return rows.filter((r) =>
    tem(f.linhas, r.linha)
    && tem(f.empresas, dimValor(r, "empresa", linhaMap))
    && tem(f.grupos, dimValor(r, "grupo", linhaMap))
    && tem(f.unidades, dimValor(r, "unidade", linhaMap))
    && tem(f.diasSemana, DIAS_SEMANA[diaSemana(r.data)]),
  );
}

function PassageirosPage() {
  useAuditView("passageiros");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const mesesQ = useQuery({ queryKey: ["passageiros-meses"], queryFn: fetchMesesImportados });
  const linhaMap = useMemo(() => new Map((linhasQ.data ?? []).map((l) => [l.linha, l])), [linhasQ.data]);

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [colsVisiveis, setColsVisiveis] = usePersistentState<string[]>("passageiros.colsVisiveis", COLS.map((c) => c.key));
  const cols = useMemo(() => COLS.filter((c) => colsVisiveis.includes(c.key)), [colsVisiveis]);
  const toggleCol = (k: ColKey) =>
    setColsVisiveis(colsVisiveis.includes(k) ? colsVisiveis.filter((x) => x !== k) : [...colsVisiveis, k]);

  // Opções de filtro: Linha = o que existe nos dados importados (o RLS já
  // tira as linhas de fora do Grupo/Empresa do usuário restrito);
  // Empresa/Grupo/Unidade = do cadastro dessas linhas.
  const [linhasNosDados, setLinhasNosDados] = useState<string[]>([]);
  const opcoes = useMemo(() => {
    const base = linhasNosDados.map((linha) => ({ linha } as PassageiroDia));
    const de = (d: Dimensao) => Array.from(new Set(base.map((r) => dimValor(r, d, linhaMap)))).sort(ordenarCodigo);
    return { linhas: [...linhasNosDados].sort(ordenarCodigo), empresas: de("empresa"), grupos: de("grupo"), unidades: de("unidade") };
  }, [linhasNosDados, linhaMap]);

  const ultimoMes = mesesQ.data?.[0];
  const primeiroMes = mesesQ.data?.at(-1);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Passageiros e Receita</h1>
          <p className="text-sm text-muted-foreground">
            {mesesQ.isLoading ? "Carregando períodos..." : ultimoMes && primeiroMes
              ? `Dados importados de ${fmtData(primeiroMes.inicio)} a ${fmtData(ultimoMes.fim)}. Empresa/Grupo/Unidade vêm do Cadastro de Linhas.`
              : "Nenhum dado importado ainda."}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild><Link to="/importacao-passageiros"><FileUp className="h-4 w-4 mr-1" /> Importar planilha</Link></Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3"><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <MultiSelect label="Empresa" values={filtros.empresas} onChange={(v) => setFiltros((s) => ({ ...s, empresas: v }))} options={opcoes.empresas} />
          <MultiSelect label="Grupo" values={filtros.grupos} onChange={(v) => setFiltros((s) => ({ ...s, grupos: v }))} options={opcoes.grupos} placeholder="Todos" />
          <MultiSelect label="Unidade" values={filtros.unidades} onChange={(v) => setFiltros((s) => ({ ...s, unidades: v }))} options={opcoes.unidades} />
          <MultiSelect label="Linha" values={filtros.linhas} onChange={(v) => setFiltros((s) => ({ ...s, linhas: v }))} options={opcoes.linhas} />
          <MultiSelect label="Dia da semana" values={filtros.diasSemana} onChange={(v) => setFiltros((s) => ({ ...s, diasSemana: v }))} options={DIAS_SEMANA} placeholder="Todos" />
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-3 flex flex-wrap items-center gap-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Campos visíveis</span>
          {COLS.map((c) => (
            <label key={c.key} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <Checkbox checked={colsVisiveis.includes(c.key)} onCheckedChange={() => toggleCol(c.key)} className="h-3.5 w-3.5" />
              {c.label}
            </label>
          ))}
        </CardContent>
      </Card>

      {ultimoMes && (
        <Tabs defaultValue="geral">
          <TabsList>
            <TabsTrigger value="geral">Visão geral</TabsTrigger>
            <TabsTrigger value="comparativo">Comparativo</TabsTrigger>
          </TabsList>
          <TabsContent value="geral">
            <VisaoGeral
              inicioPadrao={ultimoMes.inicio} fimPadrao={ultimoMes.fim}
              filtros={filtros} linhaMap={linhaMap} onLinhas={setLinhasNosDados} cols={cols}
            />
          </TabsContent>
          <TabsContent value="comparativo">
            <Comparativo ultimoFim={ultimoMes.fim} filtros={filtros} linhaMap={linhaMap} onLinhas={setLinhasNosDados} cols={cols} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/** Junta as linhas vistas nos dados (de qualquer aba) pras opções do filtro. */
function useRegistrarLinhas(rows: PassageiroDia[] | undefined, onLinhas: (fn: (prev: string[]) => string[]) => void) {
  useEffect(() => {
    if (!rows?.length) return;
    const novas = new Set(rows.map((r) => r.linha));
    onLinhas((prev) => {
      const tudo = new Set([...prev, ...novas]);
      return tudo.size === prev.length ? prev : Array.from(tudo);
    });
  }, [rows, onLinhas]);
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

type Col = (typeof COLS)[number];

function VisaoGeral({ inicioPadrao, fimPadrao, filtros, linhaMap, onLinhas, cols }: {
  inicioPadrao: string; fimPadrao: string; filtros: Filtros; linhaMap: Map<string, Linha>;
  onLinhas: (fn: (prev: string[]) => string[]) => void; cols: Col[];
}) {
  const [inicio, setInicio] = useState(inicioPadrao);
  const [fim, setFim] = useState(fimPadrao);
  const [gran, setGran] = useState<Granularidade>("dia");
  const [metrica, setMetrica] = useState<ColKey>("transportados");
  const [dim, setDim] = useState<Dimensao>("linha");
  const [ordem, setOrdem] = usePersistentState<Ordem>("passageiros.geral.ordem", "valor");

  const q = useQuery({
    queryKey: ["passageiros", inicio, fim],
    queryFn: () => fetchPassageiros(inicio, fim),
    enabled: !!inicio && !!fim && inicio <= fim,
  });
  useRegistrarLinhas(q.data, onLinhas);

  const rows = useMemo(() => aplicarFiltros(q.data ?? [], filtros, linhaMap), [q.data, filtros, linhaMap]);
  const total = useMemo(() => somar(rows), [rows]);
  const ind = indicadores(total);

  const porPeriodo = useMemo(() => {
    const rot = new Map<string, string>();
    const g = agrupar(rows, (r) => { const p = periodoDe(r.data, gran); rot.set(p.chave, p.rotulo); return p.chave; });
    const lista = Array.from(g, ([chave, rs]) => ({ chave, rotulo: rot.get(chave)!, t: somar(rs) })).sort((a, b) => a.chave.localeCompare(b.chave));
    return lista.map((p, i) => ({ ...p, anterior: i > 0 ? lista[i - 1].t : null }));
  }, [rows, gran]);

  const unidades = useMemo(() => unidadePorItem(rows, dim, linhaMap), [rows, dim, linhaMap]);
  const porDim = useMemo(() => {
    const g = agrupar(rows, (r) => dimValor(r, dim, linhaMap));
    const itens = Array.from(g, ([nome, rs]) => ({ nome, t: somar(rs) }));
    return ordenarItens(itens, ordem, (d) => valor(d.t, metrica) ?? 0, unidades, dim, linhaMap);
  }, [rows, dim, linhaMap, ordem, metrica, unidades]);
  const totalPorUnidade = useMemo(
    () => new Map(Array.from(agrupar(rows, (r) => unidades.get(dimValor(r, dim, linhaMap)) ?? SEM_UNIDADE), ([u, rs]) => [u, somar(rs)])),
    [rows, unidades, dim, linhaMap],
  );
  const blocos = ordem === "unidade" ? blocosPorUnidade(porDim, unidades) : [{ unidade: "", itens: porDim }];

  const grafico = porPeriodo.map((p) => ({ rotulo: p.rotulo, valor: valor(p.t, metrica) }));

  function exportar() {
    const wb = XLSX.utils.book_new();
    const colunas = (t: Totais) => Object.fromEntries(cols.map((c) => [c.label, valor(t, c.key)]));
    const sheetPeriodo = porPeriodo.map((p) => ({ Período: p.rotulo, Dias: p.t.dias, ...colunas(p.t) }));
    const sheetDim = porDim.map((d) => ({
      [DIMENSOES.find((x) => x.key === dim)!.label]: d.nome,
      ...(ordem === "unidade" ? { Unidade: unidades.get(d.nome) ?? SEM_UNIDADE } : {}),
      ...colunas(d.t),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetPeriodo), `Por ${gran}`);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetDim), `Por ${dim}`);
    XLSX.writeFile(wb, `passageiros_${inicio}_${fim}.xlsx`);
    void logAudit({ action: "export", entity: "passageiros", details: { inicio, fim, gran, dim } });
  }

  return (
    <div className="space-y-4 pt-2">
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 grid grid-cols-2 gap-3 md:grid-cols-7 items-end">
          <Campo rotulo="De"><Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></Campo>
          <Campo rotulo="Até"><Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
          <Campo rotulo="Agrupar tempo por">
            <Select value={gran} onValueChange={(v) => setGran(v as Granularidade)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="dia">Dia</SelectItem><SelectItem value="semana">Semana (seg–dom)</SelectItem><SelectItem value="mes">Mês</SelectItem></SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Métrica do gráfico">
            <Select value={metrica} onValueChange={(v) => setMetrica(v as ColKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{COLS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Tabela por">
            <Select value={dim} onValueChange={(v) => setDim(v as Dimensao)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DIMENSOES.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Ordenar"><SelectOrdem value={ordem} onChange={setOrdem} /></Campo>
          <Button variant="outline" onClick={exportar} disabled={!rows.length}><Download className="h-4 w-4 mr-1" /> Excel</Button>
        </CardContent>
      </Card>

      {q.isLoading ? <Carregando /> : q.error ? <Erro e={q.error} /> : !rows.length ? (
        <p className="text-sm text-muted-foreground">Nenhum dado no período/filtros escolhidos.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            <Kpi icon={Users} rotulo="Transportados" valor={fmtNum(total.transportados)} sub={`${fmtNum(ind.mediaDiaTransportados)}/dia`} />
            <Kpi icon={Ticket} rotulo="Pagantes" valor={fmtNum(total.pagantes)} />
            <Kpi icon={Percent} rotulo="Gratuidades" valor={fmtNum(total.gratuidades)} sub={COL.pctGratuidade.fmt(ind.pctGratuidade)} />
            <Kpi icon={DollarSign} rotulo="Receita" valor={fmtReais(total.receita)} sub={`${fmtReais(ind.mediaDiaReceita)}/dia`} />
            <Kpi icon={Bus} rotulo="Viagens" valor={fmtNum(total.viagens)} />
            <Kpi icon={RouteIcon} rotulo="KM" valor={fmtNum(total.km)} />
            <Kpi icon={Users} rotulo="Pax por viagem" valor={fmtNum(ind.paxPorViagem, 1)} />
            <Kpi icon={Gauge} rotulo="IPK" valor={fmtNum(ind.ipk, 2)} sub={`${fmtReais(ind.receitaPorKm)}/km`} />
          </div>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{COL[metrica].label} por {gran === "dia" ? "dia" : gran === "semana" ? "semana" : "mês"}</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={grafico} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(v)} width={70} />
                  <Tooltip formatter={(v: number) => COL[metrica].fmt(v)} />
                  <Bar dataKey="valor" name={COL[metrica].label} fill={CORES[0]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Por {gran === "dia" ? "dia" : gran === "semana" ? "semana" : "mês"} — variação contra o período anterior</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Dias</TableHead>
                    {cols.map((c) => <TableHead key={c.key} className="text-right whitespace-nowrap">{c.curto}</TableHead>)}
                    <TableHead className="text-right whitespace-nowrap">Δ Transp.</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Δ Receita</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {porPeriodo.map((p) => (
                    <TableRow key={p.chave}>
                      <TableCell className="whitespace-nowrap font-medium">{p.rotulo}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.t.dias}</TableCell>
                      {cols.map((c) => <TableCell key={c.key} className="text-right tabular-nums">{c.fmt(valor(p.t, c.key))}</TableCell>)}
                      <TableCell className="text-right"><Delta v={p.anterior ? variacao(p.anterior.transportados, p.t.transportados) : null} /></TableCell>
                      <TableCell className="text-right"><Delta v={p.anterior ? variacao(p.anterior.receita, p.t.receita) : null} /></TableCell>
                    </TableRow>
                  ))}
                  <TotalRow t={total} cols={cols} colsExtras={2} dias />
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Por {DIMENSOES.find((d) => d.key === dim)!.label}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{DIMENSOES.find((d) => d.key === dim)!.label}</TableHead>
                    {cols.map((c) => <TableHead key={c.key} className="text-right whitespace-nowrap">{c.curto}</TableHead>)}
                    <TableHead className="text-right whitespace-nowrap">% do total (transp.)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocos.map((bl) => {
                    const pct = (t: Totais) => `${fmtNum(total.transportados ? (t.transportados * 100) / total.transportados : null, 1)}%`;
                    const sub = totalPorUnidade.get(bl.unidade);
                    return (
                      <Fragment key={bl.unidade || "_"}>
                        {bl.unidade && <CabUnidade unidade={bl.unidade} span={cols.length + 2} />}
                        {bl.itens.map((d) => (
                          <TableRow key={d.nome}>
                            <TableCell className="whitespace-nowrap font-medium">{d.nome}</TableCell>
                            {cols.map((c) => <TableCell key={c.key} className="text-right tabular-nums">{c.fmt(valor(d.t, c.key))}</TableCell>)}
                            <TableCell className="text-right tabular-nums">{pct(d.t)}</TableCell>
                          </TableRow>
                        ))}
                        {bl.unidade && sub && (
                          <TableRow className="font-semibold bg-muted/30">
                            <TableCell className="whitespace-nowrap">Total {bl.unidade}</TableCell>
                            {cols.map((c) => <TableCell key={c.key} className="text-right tabular-nums">{c.fmt(valor(sub, c.key))}</TableCell>)}
                            <TableCell className="text-right tabular-nums">{pct(sub)}</TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  <TotalRow t={total} cols={cols} colsExtras={1} />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparativo: período A x período B
// ---------------------------------------------------------------------------

type Base = "total" | "media";

function Comparativo({ ultimoFim, filtros, linhaMap, onLinhas, cols }: {
  ultimoFim: string; filtros: Filtros; linhaMap: Map<string, Linha>;
  onLinhas: (fn: (prev: string[]) => string[]) => void; cols: Col[];
}) {
  // Padrão: última semana completa importada (B) x semana anterior (A).
  const fimB0 = ultimoFim;
  const iniB0 = addDias(fimB0, -6);
  const [a, setA] = useState({ inicio: addDias(iniB0, -7), fim: addDias(iniB0, -1) });
  const [b, setB] = useState({ inicio: iniB0, fim: fimB0 });
  const [base, setBase] = useState<Base>("total");
  const [dim, setDim] = useState<Dimensao>("linha");
  const [metrica, setMetrica] = useState<ColKey>("transportados");
  const [ordem, setOrdem] = usePersistentState<Ordem>("passageiros.comp.ordem", "valor");
  const [showPct, setShowPct] = usePersistentState("passageiros.comp.showPct", true);

  function atalho(tipo: "semana" | "mes" | "mesmo_mes") {
    if (tipo === "semana") {
      setA({ inicio: addDias(b.inicio, -7), fim: addDias(b.fim, -7) });
    } else if (tipo === "mes") {
      // B = mês da data final de B; A = mês anterior inteiro.
      const mesB = b.fim.slice(0, 7);
      const iniB = `${mesB}-01`;
      const fimB = addDias(addMeses(iniB, 1), -1);
      const iniA = addMeses(iniB, -1);
      setB({ inicio: iniB, fim: fimB });
      setA({ inicio: iniA, fim: addDias(iniB, -1) });
    } else {
      // Mesmo intervalo de dias, um mês antes (ex.: 01–15/set x 01–15/ago).
      setA({ inicio: addMeses(b.inicio, -1), fim: addMeses(b.fim, -1) });
    }
  }

  const ini = a.inicio < b.inicio ? a.inicio : b.inicio;
  const fim = a.fim > b.fim ? a.fim : b.fim;
  const valido = a.inicio <= a.fim && b.inicio <= b.fim;
  const q = useQuery({
    queryKey: ["passageiros", ini, fim],
    queryFn: () => fetchPassageiros(ini, fim),
    enabled: valido,
  });
  useRegistrarLinhas(q.data, onLinhas);

  const dados = useMemo(() => {
    const todos = aplicarFiltros(q.data ?? [], filtros, linhaMap);
    const rA = todos.filter((r) => r.data >= a.inicio && r.data <= a.fim);
    const rB = todos.filter((r) => r.data >= b.inicio && r.data <= b.fim);
    // Média por dia: divide pelos dias com dado no período (todas as linhas
    // filtradas) — uma linha que não roda domingo continua dividindo pelos
    // 7 dias da semana, igual ao total.
    const diasA = new Set(rA.map((r) => r.data)).size || 1;
    const diasB = new Set(rB.map((r) => r.data)).size || 1;
    return { rA, rB, diasA, diasB, tA: somar(rA), tB: somar(rB) };
  }, [q.data, filtros, linhaMap, a, b]);

  const v = (t: Totais, k: ColKey, dias: number) => {
    const x = valor(t, k);
    return x != null && base === "media" && COL[k].soma ? x / dias : x;
  };

  const unidades = useMemo(() => unidadePorItem([...dados.rA, ...dados.rB], dim, linhaMap), [dados, dim, linhaMap]);
  const porDim = useMemo(() => {
    const gA = agrupar(dados.rA, (r) => dimValor(r, dim, linhaMap));
    const gB = agrupar(dados.rB, (r) => dimValor(r, dim, linhaMap));
    const nomes = Array.from(new Set([...gA.keys(), ...gB.keys()]));
    const itens = nomes.map((nome) => ({ nome, tA: somar(gA.get(nome) ?? []), tB: somar(gB.get(nome) ?? []) }));
    return ordenarItens(itens, ordem, (d) => valor(d.tB, metrica) ?? 0, unidades, dim, linhaMap);
  }, [dados, dim, linhaMap, metrica, ordem, unidades]);
  const subtotais = useMemo(() => {
    const un = (r: PassageiroDia) => unidades.get(dimValor(r, dim, linhaMap)) ?? SEM_UNIDADE;
    const gA = agrupar(dados.rA, un), gB = agrupar(dados.rB, un);
    return (u: string) => ({ nome: `Total ${u}`, tA: somar(gA.get(u) ?? []), tB: somar(gB.get(u) ?? []) });
  }, [dados, unidades, dim, linhaMap]);
  const blocos = ordem === "unidade" ? blocosPorUnidade(porDim, unidades) : [{ unidade: "", itens: porDim }];

  // Dia a dia alinhado: 1º dia de A com 1º dia de B, e assim por diante.
  const diaADia = useMemo(() => {
    const porDiaA = agrupar(dados.rA, (r) => r.data);
    const porDiaB = agrupar(dados.rB, (r) => r.data);
    const n = Math.max(difDias(a.inicio, a.fim), difDias(b.inicio, b.fim));
    return Array.from({ length: Math.min(n, 366) }, (_, i) => {
      const dA = addDias(a.inicio, i), dB = addDias(b.inicio, i);
      const tA = porDiaA.get(dA), tB = porDiaB.get(dB);
      return {
        rotulo: `Dia ${i + 1}`,
        dataA: dA <= a.fim ? `${fmtPeriodoCurto(dA, dA)} ${DIAS_SEMANA[diaSemana(dA)]}` : "",
        dataB: dB <= b.fim ? `${fmtPeriodoCurto(dB, dB)} ${DIAS_SEMANA[diaSemana(dB)]}` : "",
        A: tA && dA <= a.fim ? valor(somar(tA), metrica) : null,
        B: tB && dB <= b.fim ? valor(somar(tB), metrica) : null,
      };
    });
  }, [dados, a, b, metrica]);

  const rotA = `A = ${fmtPeriodoCurto(a.inicio, a.fim)}`;
  const rotB = `B = ${fmtPeriodoCurto(b.inicio, b.fim)}`;
  const nomeDim = DIMENSOES.find((d) => d.key === dim)!.label;

  function exportar() {
    const linhas = porDim.map((d) => {
      const o: Record<string, string | number | null> = { [nomeDim]: d.nome };
      if (ordem === "unidade") o.Unidade = unidades.get(d.nome) ?? SEM_UNIDADE;
      for (const c of cols) {
        const va = v(d.tA, c.key, dados.diasA), vb = v(d.tB, c.key, dados.diasB);
        o[`${c.label} (${rotA})`] = va;
        o[`${c.label} (${rotB})`] = vb;
        if (showPct) o[`${c.label} Δ%`] = variacao(va, vb);
      }
      return o;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Comparativo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(diaADia.map((d) => ({ Dia: d.rotulo, "Data A": d.dataA, [`${COL[metrica].label} (${rotA})`]: d.A, "Data B": d.dataB, [`${COL[metrica].label} (${rotB})`]: d.B }))), "Dia a dia");
    XLSX.writeFile(wb, `passageiros_comparativo_${a.inicio}_${b.inicio}.xlsx`);
    void logAudit({ action: "export", entity: "passageiros", details: { comparativo: true, a, b, base, dim } });
  }

  return (
    <div className="space-y-4 pt-2">
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 items-end">
            <Campo rotulo="Período A — de"><Input type="date" value={a.inicio} onChange={(e) => setA((s) => ({ ...s, inicio: e.target.value }))} /></Campo>
            <Campo rotulo="Período A — até"><Input type="date" value={a.fim} onChange={(e) => setA((s) => ({ ...s, fim: e.target.value }))} /></Campo>
            <Campo rotulo="Período B — de"><Input type="date" value={b.inicio} onChange={(e) => setB((s) => ({ ...s, inicio: e.target.value }))} /></Campo>
            <Campo rotulo="Período B — até"><Input type="date" value={b.fim} onChange={(e) => setB((s) => ({ ...s, fim: e.target.value }))} /></Campo>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground self-center">A em relação a B:</span>
              <Button size="sm" variant="outline" onClick={() => atalho("semana")}>Semana anterior</Button>
              <Button size="sm" variant="outline" onClick={() => atalho("mesmo_mes")}>Mesmos dias do mês anterior</Button>
              <Button size="sm" variant="outline" onClick={() => atalho("mes")}>Mês x mês anterior</Button>
            </div>
            <div className="ml-auto flex flex-wrap gap-3 items-end">
              <Campo rotulo="Comparar">
                <Select value={base} onValueChange={(x) => setBase(x as Base)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="total">Totais</SelectItem><SelectItem value="media">Média por dia</SelectItem></SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Por">
                <Select value={dim} onValueChange={(x) => setDim(x as Dimensao)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{DIMENSOES.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Métrica (gráfico/ordem)">
                <Select value={metrica} onValueChange={(x) => setMetrica(x as ColKey)}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>{COLS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </Campo>
              <Campo rotulo="Ordenar"><SelectOrdem value={ordem} onChange={setOrdem} /></Campo>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer h-9">
                <Checkbox checked={showPct} onCheckedChange={(x) => setShowPct(!!x)} className="h-3.5 w-3.5" />
                Mostrar Δ%
              </label>
              <Button variant="outline" onClick={exportar} disabled={!porDim.length}><Download className="h-4 w-4 mr-1" /> Excel</Button>
            </div>
          </div>
          {dados.diasA !== dados.diasB && base === "total" && (
            <p className="text-xs text-warning">Os períodos têm quantidade de dias com dado diferente (A: {dados.diasA}, B: {dados.diasB}) — use "Média por dia" para comparar de forma justa.</p>
          )}
        </CardContent>
      </Card>

      {!valido ? <p className="text-sm text-destructive">Data inicial depois da final em um dos períodos.</p>
        : q.isLoading ? <Carregando /> : q.error ? <Erro e={q.error} /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {(["transportados", "pagantes", "receita", "viagens", "ipk"] as ColKey[]).map((k) => {
              const va = v(dados.tA, k, dados.diasA), vb = v(dados.tB, k, dados.diasB);
              return (
                <Card key={k} className="shadow-[var(--shadow-card)]">
                  <CardContent className="p-4">
                    <div className="text-xs text-muted-foreground">{COL[k].label}{base === "media" && COL[k].soma ? " / dia" : ""}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{COL[k].fmt(vb)}</div>
                    <div className="text-[11px] text-muted-foreground">{rotB}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{rotA}: {COL[k].fmt(va)} · <Delta v={variacao(va, vb)} /></div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{COL[metrica].label} dia a dia — A x B (1º dia com 1º dia)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={diaADia} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(x) => fmtNum(x)} width={70} />
                  <Tooltip
                    formatter={(x: number) => COL[metrica].fmt(x)}
                    labelFormatter={(_, p) => { const d = p?.[0]?.payload; return d ? `${d.rotulo} — A: ${d.dataA || "—"} · B: ${d.dataB || "—"}` : ""; }}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="A" name={rotA} stroke={CORES[1]} strokeWidth={2} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="B" name={rotB} stroke={CORES[0]} strokeWidth={2} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Por {nomeDim} — {base === "media" ? "média por dia" : "totais"}</CardTitle>
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold" style={{ color: CORES[1] }}>{rotA}</span>
                {" · "}
                <span className="font-semibold" style={{ color: CORES[0] }}>{rotB}</span>
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={2}>{nomeDim}</TableHead>
                    {cols.map((c) => <TableHead key={c.key} colSpan={showPct ? 3 : 2} className="text-center whitespace-nowrap border-l">{c.curto}</TableHead>)}
                  </TableRow>
                  <TableRow>
                    {cols.map((c) => (
                      <SubCab key={c.key} rotA={rotA} rotB={rotB} showPct={showPct} />
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocos.map((bl) => (
                    <Fragment key={bl.unidade || "_"}>
                      {bl.unidade && <CabUnidade unidade={bl.unidade} span={1 + cols.length * (showPct ? 3 : 2)} />}
                      {[...bl.itens, ...(bl.unidade ? [subtotais(bl.unidade)] : [])].map((d) => (
                        <LinhaComparacao key={d.nome} d={d} cols={cols} v={v} diasA={dados.diasA} diasB={dados.diasB} showPct={showPct}
                          className={bl.unidade && d.nome === `Total ${bl.unidade}` ? "font-semibold bg-muted/30" : undefined} />
                      ))}
                    </Fragment>
                  ))}
                  <LinhaComparacao d={{ nome: "Total", tA: dados.tA, tB: dados.tB }} cols={cols} v={v} diasA={dados.diasA} diasB={dados.diasB} showPct={showPct} className="font-semibold bg-muted/50" />
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function addMeses(data: string, n: number): string {
  const [y, m, d] = data.split("-").map(Number);
  const alvo = new Date(y, m - 1 + n, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Pedaços de UI
// ---------------------------------------------------------------------------

function SubCab({ rotA, rotB, showPct }: { rotA: string; rotB: string; showPct: boolean }) {
  return (
    <>
      <TableHead className="text-right border-l text-xs whitespace-nowrap" style={{ color: CORES[1] }}>{rotA}</TableHead>
      <TableHead className="text-right text-xs whitespace-nowrap" style={{ color: CORES[0] }}>{rotB}</TableHead>
      {showPct && <TableHead className="text-right text-xs">Δ%</TableHead>}
    </>
  );
}

type ItemComparacao = { nome: string; tA: Totais; tB: Totais };

function LinhaComparacao({ d, cols, v, diasA, diasB, showPct, className }: {
  d: ItemComparacao; cols: Col[]; v: (t: Totais, k: ColKey, dias: number) => number | null;
  diasA: number; diasB: number; showPct: boolean; className?: string;
}) {
  return (
    <TableRow className={className}>
      <TableCell className="whitespace-nowrap font-medium">{d.nome}</TableCell>
      {cols.map((c) => {
        const va = v(d.tA, c.key, diasA), vb = v(d.tB, c.key, diasB);
        return (
          <Fragment key={c.key}>
            <TableCell className="text-right tabular-nums border-l text-muted-foreground">{c.fmt(va)}</TableCell>
            <TableCell className="text-right tabular-nums">{c.fmt(vb)}</TableCell>
            {showPct && <TableCell className="text-right"><Delta v={variacao(va, vb)} /></TableCell>}
          </Fragment>
        );
      })}
    </TableRow>
  );
}

function CabUnidade({ unidade, span }: { unidade: string; span: number }) {
  return (
    <TableRow className="bg-primary/5 hover:bg-primary/5">
      <TableCell colSpan={span} className="py-1.5 text-xs font-semibold uppercase tracking-wider text-primary">{unidade}</TableCell>
    </TableRow>
  );
}

function TotalRow({ t, cols, colsExtras, dias }: { t: Totais; cols: Col[]; colsExtras: number; dias?: boolean }) {
  return (
    <TableRow className="font-semibold bg-muted/50">
      <TableCell>Total</TableCell>
      {dias && <TableCell className="text-right tabular-nums">{t.dias}</TableCell>}
      {cols.map((c) => <TableCell key={c.key} className="text-right tabular-nums">{c.fmt(valor(t, c.key))}</TableCell>)}
      {Array.from({ length: colsExtras }, (_, i) => <TableCell key={i} />)}
    </TableRow>
  );
}

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const cls = v > 0.05 ? "text-success" : v < -0.05 ? "text-destructive" : "text-muted-foreground";
  return <span className={`tabular-nums ${cls}`}>{v > 0 ? "+" : ""}{fmtNum(v, 1)}%</span>;
}

function Kpi({ icon: Icon, rotulo, valor, sub }: { icon: LucideIcon; rotulo: string; valor: string; sub?: string }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs"><Icon className="h-3.5 w-3.5" /> {rotulo}</div>
        <p className="mt-1 text-lg font-bold tabular-nums leading-tight">{valor}</p>
        {sub && <p className="text-xs text-muted-foreground tabular-nums">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{rotulo}</Label>
      {children}
    </div>
  );
}

function Carregando() {
  return <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>;
}

function Erro({ e }: { e: unknown }) {
  return <p className="text-sm text-destructive">Erro ao carregar: {(e as Error).message}</p>;
}
