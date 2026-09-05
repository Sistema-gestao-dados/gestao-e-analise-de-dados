import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchRealizado, fetchRealizadoDatasDisponiveis } from "@/lib/viagens-realizado";
import { fetchLinhas } from "@/lib/data";
import { classificar, STATUS_LABEL, STATUS_COLOR, type StatusViagem, type RealizadoRow } from "@/lib/realizado";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/multi-select";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, Legend, CartesianGrid,
} from "recharts";
import { FileUp, ArrowRight, Gauge, Clock, XCircle, AlertTriangle, Timer } from "lucide-react";
import { useAuditView } from "@/lib/use-audit-view";
import { usePersistentState } from "@/hooks/use-persistent-state";

export const Route = createFileRoute("/realizado")({
  head: () => ({ meta: [{ title: "Realizado — Gestão e Análise de Dados" }] }),
  component: RealizadoPage,
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function RealizadoPage() {
  useAuditView("realizado");

  const [dataInicio, setDataInicio] = usePersistentState("realizado.dataInicio", daysAgoISO(7));
  const [dataFim, setDataFim] = usePersistentState("realizado.dataFim", todayISO());
  const [fEmpresa, setFEmpresa] = usePersistentState<string[]>("realizado.fEmpresa", []);
  const [fLinha, setFLinha] = usePersistentState<string[]>("realizado.fLinha", []);
  const [tolerancia, setTolerancia] = usePersistentState("realizado.tolerancia", 5);

  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const datasQ = useQuery({ queryKey: ["viagens-realizado-datas"], queryFn: fetchRealizadoDatasDisponiveis });
  const dataQ = useQuery({
    queryKey: ["viagens-realizado", dataInicio, dataFim],
    queryFn: () => fetchRealizado(dataInicio, dataFim),
    enabled: !!dataInicio && !!dataFim,
  });

  const linhas = linhasQ.data ?? [];
  const datasDisponiveis = datasQ.data ?? [];
  const raw = dataQ.data ?? [];

  const opts = useMemo(() => ({
    empresa: Array.from(new Set(raw.map((r) => r.empresa).filter(Boolean) as string[])).sort(),
    linha: Array.from(new Set(raw.map((r) => r.linha).filter(Boolean))).sort(),
  }), [raw]);

  const filtered = useMemo(() => {
    return raw.filter((r) => {
      if (fEmpresa.length && !fEmpresa.includes(r.empresa ?? "")) return false;
      if (fLinha.length && !fLinha.includes(r.linha)) return false;
      return true;
    });
  }, [raw, fEmpresa, fLinha]);

  const classificado = useMemo(
    () => filtered.map((r) => ({ ...r, status: classificar(r, tolerancia) })),
    [filtered, tolerancia],
  );

  const kpis = useMemo(() => {
    const total = classificado.length;
    const contagem: Record<StatusViagem, number> = { perdida: 0, incompleta: 0, atrasada: 0, adiantada: 0, no_horario: 0 };
    let somaAtraso = 0, nAtraso = 0;
    for (const r of classificado) {
      contagem[r.status as StatusViagem]++;
      if (r.dif_partida != null) { somaAtraso += r.dif_partida; nAtraso++; }
    }
    const realizadas = total - contagem.perdida;
    const pontualidade = realizadas > 0 ? (contagem.no_horario / realizadas) * 100 : 0;
    const taxaPerda = total > 0 ? (contagem.perdida / total) * 100 : 0;
    const atrasoMedio = nAtraso > 0 ? somaAtraso / nAtraso : 0;
    return { total, contagem, pontualidade, taxaPerda, atrasoMedio, realizadas };
  }, [classificado]);

  const pizza = useMemo(
    () => (Object.keys(kpis.contagem) as StatusViagem[])
      .filter((s) => kpis.contagem[s] > 0)
      .map((s) => ({ name: STATUS_LABEL[s], value: kpis.contagem[s], color: STATUS_COLOR[s] })),
    [kpis],
  );

  const porLinha = useMemo(() => {
    const m = new Map<string, { linha: string; total: number; problema: number }>();
    for (const r of classificado) {
      const cur = m.get(r.linha) ?? { linha: r.linha, total: 0, problema: 0 };
      cur.total++;
      if (r.status !== "no_horario") cur.problema++;
      m.set(r.linha, cur);
    }
    return Array.from(m.values())
      .map((x) => ({ ...x, pct: x.total > 0 ? (x.problema / x.total) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 12);
  }, [classificado]);

  const porEmpresa = useMemo(() => {
    const m = new Map<string, { empresa: string; total: number; problema: number }>();
    for (const r of classificado) {
      const key = r.empresa || "Sem empresa";
      const cur = m.get(key) ?? { empresa: key, total: 0, problema: 0 };
      cur.total++;
      if (r.status !== "no_horario") cur.problema++;
      m.set(key, cur);
    }
    return Array.from(m.values())
      .map((x) => ({ ...x, pct: x.total > 0 ? (x.problema / x.total) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [classificado]);

  const porFaixaHoraria = useMemo(() => {
    const m = new Map<string, { faixa: string; total: number; atrasada: number; adiantada: number; perdida: number }>();
    for (const r of classificado) {
      if (!r.prev_partida) continue;
      const h = r.prev_partida.slice(0, 2);
      const faixa = `${h}h`;
      const cur = m.get(faixa) ?? { faixa, total: 0, atrasada: 0, adiantada: 0, perdida: 0 };
      cur.total++;
      if (r.status === "atrasada") cur.atrasada++;
      if (r.status === "adiantada") cur.adiantada++;
      if (r.status === "perdida") cur.perdida++;
      m.set(faixa, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.faixa.localeCompare(b.faixa));
  }, [classificado]);

  const piorLinha = porLinha[0];
  const piorEmpresa = porEmpresa[0];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Realizado — Previsto x Realizado</h1>
          <p className="text-sm text-muted-foreground">
            Visão macro de um período já encerrado: pontualidade, atrasos e viagens perdidas, por linha e por empresa.
          </p>
        </div>
        <Button variant="outline" asChild size="sm">
          <Link to="/importacao-realizado">Importar CSV <ArrowRight className="h-4 w-4 ml-1" /></Link>
        </Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Data início</Label>
            <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-xs">Data fim</Label>
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-40" />
          </div>
          <MultiSelect label="Empresa" values={fEmpresa} onChange={setFEmpresa} options={opts.empresa} className="w-56" />
          <MultiSelect label="Linha" values={fLinha} onChange={setFLinha} options={opts.linha} className="w-56" />
          <div>
            <Label className="text-xs">Tolerância "no horário"</Label>
            <Select value={String(tolerancia)} onValueChange={(v) => setTolerancia(Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[3, 5, 10, 15].map((n) => <SelectItem key={n} value={String(n)}>± {n} min</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {datasDisponiveis.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {datasDisponiveis.length} dia(s) importado(s), de {datasDisponiveis[datasDisponiveis.length - 1]} a {datasDisponiveis[0]}
            </Badge>
          )}
        </CardContent>
      </Card>

      {dataQ.isLoading ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Carregando...</CardContent></Card>
      ) : kpis.total === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">Nenhuma viagem realizada importada para esse período/filtro.</p>
            <Button asChild size="sm"><Link to="/importacao-realizado"><FileUp className="h-4 w-4 mr-1" /> Importar CSV</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard icon={Gauge} label="Pontualidade" value={`${kpis.pontualidade.toFixed(1)}%`} tone={kpis.pontualidade >= 85 ? "green" : kpis.pontualidade >= 70 ? "amber" : "red"} />
            <KpiCard icon={Clock} label="Atraso médio" value={`${kpis.atrasoMedio.toFixed(1)} min`} tone={Math.abs(kpis.atrasoMedio) <= tolerancia ? "green" : "amber"} />
            <KpiCard icon={XCircle} label="Viagens perdidas" value={`${kpis.contagem.perdida} (${kpis.taxaPerda.toFixed(1)}%)`} tone={kpis.taxaPerda <= 2 ? "green" : kpis.taxaPerda <= 5 ? "amber" : "red"} />
            <KpiCard icon={AlertTriangle} label="Incompletas" value={String(kpis.contagem.incompleta)} tone={kpis.contagem.incompleta === 0 ? "green" : "amber"} />
            <KpiCard icon={Timer} label="Total de viagens" value={String(kpis.total)} tone="neutral" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="shadow-[var(--shadow-card)] lg:col-span-1">
              <CardHeader><CardTitle className="text-sm">Classificação geral</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pizza} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                      {pizza.map((p, i) => <Cell key={i} fill={p.color} />)}
                    </Pie>
                    <Legend verticalAlign="bottom" height={24} />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-[var(--shadow-card)] lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm">Linhas com mais problema (fora do horário, perdida ou incompleta)</CardTitle>
                {piorLinha && <p className="text-xs text-muted-foreground">Pior linha: <strong>{piorLinha.linha}</strong> — {piorLinha.pct.toFixed(0)}% das viagens com problema</p>}
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={porLinha} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} unit="%" />
                    <YAxis type="category" dataKey="linha" width={70} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Bar dataKey="pct" fill="#f59e0b" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-[var(--shadow-card)]">
              <CardHeader>
                <CardTitle className="text-sm">Empresas com mais problema</CardTitle>
                {piorEmpresa && <p className="text-xs text-muted-foreground">Pior empresa: <strong>{piorEmpresa.empresa}</strong> — {piorEmpresa.pct.toFixed(0)}%</p>}
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(200, porEmpresa.length * 34)}>
                  <BarChart data={porEmpresa} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} unit="%" />
                    <YAxis type="category" dataKey="empresa" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Bar dataKey="pct" fill="#dc2626" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="shadow-[var(--shadow-card)]">
              <CardHeader><CardTitle className="text-sm">Por faixa horária (previsto)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={porFaixaHoraria} margin={{ top: 20, right: 8, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="atrasada" stackId="a" fill={STATUS_COLOR.atrasada} name="Atrasada" />
                    <Bar dataKey="adiantada" stackId="a" fill={STATUS_COLOR.adiantada} name="Adiantada" />
                    <Bar dataKey="perdida" stackId="a" fill={STATUS_COLOR.perdida} name="Perdida" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: "green" | "amber" | "red" | "neutral" }) {
  const toneClasses: Record<string, string> = {
    green: "from-emerald-500/10 to-emerald-500/0 text-emerald-500",
    amber: "from-amber-500/10 to-amber-500/0 text-amber-500",
    red: "from-red-500/10 to-red-500/0 text-red-500",
    neutral: "from-muted/40 to-muted/0 text-foreground",
  };
  return (
    <Card className={`relative overflow-hidden rounded-2xl border-border/60 bg-gradient-to-br ${toneClasses[tone]} bg-card/80 backdrop-blur-sm`}>
      <CardContent className="relative p-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}
