import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLinhas, fetchEmpresaEstacao } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import { fetchProjetosAtivos, filterViagensAtivas } from "@/lib/projeto-ativo";
import {
  buildJornadas, fmtDur, intraJornadaMin, classificarIntra,
  INTRA_MINIMO_MIN, INTRA_CRITICO_MIN, type JornadaServico, type ClassificacaoIntra,
} from "@/lib/jornada";
import { buildEmpresaOverrideMap, resolveGrupoViagem, resolveEmpresaViagem, resolveUnidadeViagem, buildEmpresaPorServico, buildGrupoPorServico, buildUnidadePorServico } from "@/lib/empresa-estacao";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MultiSelect } from "@/components/multi-select";
import { useAuditView } from "@/lib/use-audit-view";
import { AlertTriangle, AlertCircle, CheckCircle2, Timer, ArrowLeft } from "lucide-react";
import { usePersistentState } from "@/hooks/use-persistent-state";

export const Route = createFileRoute("/intra-jornada")({
  head: () => ({
    meta: [
      { title: "Intra Jornada — Gestão e Análise de Dados" },
      { name: "description", content: "Descanso entre os dois turnos do serviço TU — mínimo de 3h exigido." },
    ],
  }),
  component: IntraJornadaPage,
});

const CLASS_CFG: Record<ClassificacaoIntra, { label: string; tone: string; icon: any }> = {
  critico: { label: "Crítico (< 2h)", tone: "bg-destructive/10 text-destructive ring-destructive/20", icon: AlertTriangle },
  fora_regra: { label: "Fora da regra (2h–3h)", tone: "bg-warning/10 text-warning ring-warning/20", icon: AlertCircle },
  ok: { label: "Dentro da regra (≥ 3h)", tone: "bg-success/10 text-success ring-success/20", icon: CheckCircle2 },
};

function Kpi({ label, value, icon: Icon, tone = "primary" }: any) {
  const map: any = {
    primary: "bg-primary/10 text-primary ring-primary/20",
    warning: "bg-warning/10 text-warning ring-warning/20",
    danger: "bg-destructive/10 text-destructive ring-destructive/20",
    success: "bg-success/10 text-success ring-success/20",
  };
  return (
    <Card className="shadow-[var(--shadow-card)]">
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

function IntraJornadaPage() {
  useAuditView("intra_jornada");
  const [fDia, setFDia] = usePersistentState("intra.fDia", "__all");
  const [fVersao, setFVersao] = usePersistentState("intra.fVersao", "__all");
  const [fLinha, setFLinha] = usePersistentState<string[]>("intra.fLinha", []);
  const [fUnidade, setFUnidade] = usePersistentState("intra.fUnidade", "__all");
  const [fGrupoOrdem, setFGrupoOrdem] = usePersistentState("intra.fGrupoOrdem", "__all");
  const [fClasse, setFClasse] = usePersistentState("intra.fClasse", "__all");
  const [pageSize, setPageSize] = usePersistentState("intra.pageSize", 50);
  const [page, setPage] = useState(0);
  const [somenteAtivos, setSomenteAtivos] = usePersistentState("intra.somenteAtivos", true);
  type Snap = { dia: string; versao: string; linha: string[]; unidade: string; grupoOrdem: string };
  const [applied, setApplied] = useState<Snap | null>({ dia: "__all", versao: "__all", linha: [], unidade: "__all", grupoOrdem: "__all" });

  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const empresaEstacaoQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });
  const viagensRaw = viagensQ.data ?? [];
  const linhas = linhasQ.data ?? [];
  const empresaEstacao = empresaEstacaoQ.data ?? [];
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
    unidade: Array.from(new Set(linhas.map((l) => l.unidade).filter(Boolean) as string[])).sort(),
    grupoOrdem: Array.from(new Set([
      ...linhas.map((l) => l.ordem).filter(Boolean) as string[],
      ...empresaEstacao.map((e) => e.grupo).filter(Boolean) as string[],
    ])).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
  }), [viagens, linhas, empresaEstacao]);

  const filtered = useMemo(() => {
    if (!applied) return [];
    const set = new Set(applied.linha);
    return viagens.filter((v) => {
      if (applied.dia !== "__all" && v.tipo_operacao !== applied.dia) return false;
      if (applied.versao !== "__all" && v.versao_programacao !== applied.versao) return false;
      if (set.size && !set.has(v.linha)) return false;
      if (applied.unidade !== "__all" && resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) !== applied.unidade) return false;
      if (applied.grupoOrdem !== "__all" && resolveGrupoViagem(v, linhaMap, empresaOverrideMap) !== applied.grupoOrdem) return false;
      return true;
    });
  }, [viagens, applied, linhaMap, empresaOverrideMap]);

  // Só serviços TU completos (T1 e T2), com o intervalo real calculado.
  const intras = useMemo(() => {
    if (!applied) return [];
    const jornadas = buildJornadas(filtered, linhas).filter((j) => j.tipoServico === "TU" && !j.incompleto);
    return jornadas
      .map((j) => ({ jornada: j, intraMin: intraJornadaMin(j) }))
      .filter((x): x is { jornada: JornadaServico; intraMin: number } => x.intraMin != null)
      .map((x) => ({ ...x, classe: classificarIntra(x.intraMin) }));
  }, [applied, filtered, linhas]);

  const intrasFiltradas = useMemo(() => {
    if (fClasse === "__all") return intras;
    return intras.filter((x) => x.classe === fClasse);
  }, [intras, fClasse]);

  const totais = useMemo(() => ({
    total: intras.length,
    critico: intras.filter((x) => x.classe === "critico").length,
    foraRegra: intras.filter((x) => x.classe === "fora_regra").length,
    ok: intras.filter((x) => x.classe === "ok").length,
  }), [intras]);

  const totalPaginas = Math.max(1, Math.ceil(intrasFiltradas.length / pageSize));
  const paginaAtual = Math.min(page, totalPaginas - 1);
  const pagina = useMemo(
    () => intrasFiltradas.slice(paginaAtual * pageSize, paginaAtual * pageSize + pageSize),
    [intrasFiltradas, paginaAtual, pageSize],
  );
  useEffect(() => setPage(0), [applied, pageSize, fClasse]);

  // Resumo Gerencial por Empresa / Unidade / Grupo
  const empresaPorServico = useMemo(() => buildEmpresaPorServico(filtered, linhaMap, empresaOverrideMap), [filtered, linhaMap, empresaOverrideMap]);
  const unidadePorServico = useMemo(() => buildUnidadePorServico(filtered, linhaMap, empresaOverrideMap), [filtered, linhaMap, empresaOverrideMap]);
  const grupoPorServico = useMemo(() => buildGrupoPorServico(filtered, linhaMap, empresaOverrideMap), [filtered, linhaMap, empresaOverrideMap]);

  function resumoPorChave(chaveFn: (x: typeof intras[number]) => string) {
    const m = new Map<string, { total: number; critico: number; foraRegra: number; ok: number }>();
    for (const x of intras) {
      const k = chaveFn(x);
      const cur = m.get(k) ?? { total: 0, critico: 0, foraRegra: 0, ok: 0 };
      cur.total++;
      if (x.classe === "critico") cur.critico++;
      else if (x.classe === "fora_regra") cur.foraRegra++;
      else cur.ok++;
      m.set(k, cur);
    }
    return Array.from(m, ([chave, v]) => ({ chave, ...v })).sort((a, b) => a.chave.localeCompare(b.chave, "pt-BR"));
  }
  const resumoEmpresa = useMemo(
    () => resumoPorChave((x) => empresaPorServico.get(x.jornada.vehicleKey) || linhaMap.get(x.jornada.linha)?.empresa || "Sem empresa"),
    [intras, empresaPorServico, linhaMap],
  );
  const resumoUnidade = useMemo(
    () => resumoPorChave((x) => unidadePorServico.get(x.jornada.vehicleKey) || linhaMap.get(x.jornada.linha)?.unidade || "Sem unidade"),
    [intras, unidadePorServico, linhaMap],
  );
  const resumoGrupo = useMemo(
    () => resumoPorChave((x) => grupoPorServico.get(x.jornada.vehicleKey) || linhaMap.get(x.jornada.linha)?.ordem || "Sem grupo"),
    [intras, grupoPorServico, linhaMap],
  );

  function aplicarFiltros() {
    setApplied({ dia: fDia, versao: fVersao, linha: fLinha, unidade: fUnidade, grupoOrdem: fGrupoOrdem });
  }

  const loading = viagensQ.isLoading || linhasQ.isLoading;

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2"><Link to="/jornada"><ArrowLeft className="h-4 w-4 mr-1" /> Jornada de Trabalho</Link></Button>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Intra Jornada (TU)</h1>
        <p className="text-sm text-muted-foreground">
          Descanso real entre o 1º e o 2º turno do mesmo motorista (TU) — já contando antecipação e prestação de contas.
          Mínimo exigido: <strong>{fmtDur(INTRA_MINIMO_MIN)}</strong>. Abaixo de <strong>{fmtDur(INTRA_CRITICO_MIN)}</strong> é crítico.
        </p>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <Checkbox checked={somenteAtivos} onCheckedChange={(v) => setSomenteAtivos(!!v)} />
            Somente projeto ativo
          </label>
          <FiltroSelect label="Dia Tipo" value={fDia} onChange={setFDia} options={opts.dia} />
          <FiltroSelect label="Versão" value={fVersao} onChange={setFVersao} options={opts.versao} />
          <MultiSelect label="Linha" values={fLinha} onChange={setFLinha} options={opts.linha} className="w-56" />
          <FiltroSelect label="Unidade" value={fUnidade} onChange={setFUnidade} options={opts.unidade} />
          <FiltroSelect label="Grupo" value={fGrupoOrdem} onChange={setFGrupoOrdem} options={opts.grupoOrdem} />
          <Button size="sm" onClick={aplicarFiltros} disabled={loading}>Consultar</Button>
        </CardContent>
      </Card>

      {!applied ? null : loading ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Carregando...</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Serviços TU (completos)" value={totais.total} icon={Timer} tone="primary" />
            <Kpi label="Críticos (< 2h)" value={totais.critico} icon={AlertTriangle} tone="danger" />
            <Kpi label="Fora da regra (2h–3h)" value={totais.foraRegra} icon={AlertCircle} tone="warning" />
            <Kpi label="Dentro da regra (≥ 3h)" value={totais.ok} icon={CheckCircle2} tone="success" />
          </div>

          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="p-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Classificação:</span>
              {(["__all", "critico", "fora_regra", "ok"] as const).map((c) => (
                <Button key={c} size="sm" variant={fClasse === c ? "default" : "outline"} onClick={() => setFClasse(c)}>
                  {c === "__all" ? "Todos" : CLASS_CFG[c].label}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="p-0">
              {intrasFiltradas.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Nenhum serviço TU completo encontrado com esses filtros.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Linha</TableHead>
                        <TableHead>Serviço</TableHead>
                        <TableHead>Versão</TableHead>
                        <TableHead>Fim T1 (c/ prestação)</TableHead>
                        <TableHead>Início T2 (c/ antecipação)</TableHead>
                        <TableHead>Intervalo</TableHead>
                        <TableHead>Classificação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagina.map((x) => {
                        const t1 = x.jornada.turnos.find((t) => t.turno === "1")!;
                        const t2 = x.jornada.turnos.find((t) => t.turno === "2")!;
                        const cfg = CLASS_CFG[x.classe];
                        const Icon = cfg.icon;
                        return (
                          <TableRow key={x.jornada.vehicleKey}>
                            <TableCell className="font-medium">{x.jornada.linha}</TableCell>
                            <TableCell>{x.jornada.servico}</TableCell>
                            <TableCell>{x.jornada.versao}</TableCell>
                            <TableCell>{t1.ultimaChegada} + {t1.prestacao}min</TableCell>
                            <TableCell>{t2.primeiraPartida} − {t2.antecipacao}min</TableCell>
                            <TableCell className="tabular-nums">{fmtDur(x.intraMin)}</TableCell>
                            <TableCell>
                              <Badge className={`gap-1 ring-1 ${cfg.tone}`} variant="outline"><Icon className="h-3 w-3" />{cfg.label}</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {intrasFiltradas.length > 0 && (
                <div className="flex items-center justify-between gap-3 flex-wrap p-3 border-t">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Exibir</span>
                    <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                      <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{[50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                    </Select>
                    <span>por página · {intrasFiltradas.length} no total</span>
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

          <ResumoIntraTable titulo="Resumo Gerencial por Empresa" rows={resumoEmpresa} />
          <ResumoIntraTable titulo="Resumo Gerencial por Grupo" rows={resumoGrupo} />
          <ResumoIntraTable titulo="Resumo Gerencial por Unidade" rows={resumoUnidade} />
        </>
      )}
    </div>
  );
}

function FiltroSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Todos</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

type ResumoIntraRow = { chave: string; total: number; critico: number; foraRegra: number; ok: number };
function ResumoIntraTable({ titulo, rows }: { titulo: string; rows: ResumoIntraRow[] }) {
  if (rows.length === 0) return null;
  const tot = rows.reduce((s, r) => ({ total: s.total + r.total, critico: s.critico + r.critico, foraRegra: s.foraRegra + r.foraRegra, ok: s.ok + r.ok }), { total: 0, critico: 0, foraRegra: 0, ok: 0 });
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{titulo}</CardTitle></CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="px-2 py-1"></TableHead>
                <TableHead className="px-2 py-1 text-right">Total TU</TableHead>
                <TableHead className="px-2 py-1 text-right text-destructive">Crítico</TableHead>
                <TableHead className="px-2 py-1 text-right text-warning">Fora da regra</TableHead>
                <TableHead className="px-2 py-1 text-right text-success">Dentro da regra</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.chave} className="h-8">
                  <TableCell className="px-2 py-1 font-medium">{r.chave}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{r.total}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{r.critico}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{r.foraRegra}</TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums">{r.ok}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50 font-bold h-9">
                <TableCell className="px-2 py-1">TOTAL</TableCell>
                <TableCell className="px-2 py-1 text-right tabular-nums">{tot.total}</TableCell>
                <TableCell className="px-2 py-1 text-right tabular-nums">{tot.critico}</TableCell>
                <TableCell className="px-2 py-1 text-right tabular-nums">{tot.foraRegra}</TableCell>
                <TableCell className="px-2 py-1 text-right tabular-nums">{tot.ok}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
