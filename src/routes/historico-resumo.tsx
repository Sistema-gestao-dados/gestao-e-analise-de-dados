import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchHistorico, buildGrupoParaLinhas } from "@/lib/historico";
import { fetchLinhas, fetchMulti } from "@/lib/data";
import { useAuditView } from "@/lib/use-audit-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from "recharts";
import { Activity, Bus, Calendar, TrendingUp, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/historico-resumo")({
  head: () => ({ meta: [{ title: "Resumo — Histórico de Reprogramação" }] }),
  component: ResumoPage,
});

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const CHART_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed"];

function ResumoPage() {
  useAuditView("historico_reprogramacao_resumo");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const historicoQ = useQuery({ queryKey: ["historico-reprogramacao"], queryFn: fetchHistorico });

  const linhas = linhasQ.data ?? [];
  const multi = multiQ.data ?? [];
  const historico = historicoQ.data ?? [];

  const empresaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l.empresa])), [linhas]);
  const grupoParaLinhas = useMemo(() => buildGrupoParaLinhas(multi), [multi]);

  const [f, setF] = useState({ linha: "", ano: "__all", mes: "__all", dia_tipo: "__all", grupo: "__all", empresa: "__all" });

  const opts = useMemo(() => ({
    empresa: Array.from(new Set(linhas.map((l) => l.empresa).filter(Boolean) as string[])).sort(),
    grupo: Array.from(grupoParaLinhas.keys()).sort(),
    diaTipo: Array.from(new Set(historico.map((h) => h.dia_tipo).filter(Boolean) as string[])).sort(),
    ano: Array.from(new Set(historico.map((h) => h.vigencia?.slice(0, 4)).filter(Boolean) as string[])).sort(),
  }), [historico, linhas, grupoParaLinhas]);

  const filtered = useMemo(() => {
    return historico.filter((h) => {
      if (f.linha && !h.linha.toLowerCase().includes(f.linha.toLowerCase())) return false;
      if (f.dia_tipo !== "__all" && h.dia_tipo !== f.dia_tipo) return false;
      if (f.ano !== "__all" && h.vigencia?.slice(0, 4) !== f.ano) return false;
      if (f.mes !== "__all" && h.vigencia?.slice(5, 7) !== f.mes) return false;
      if (f.empresa !== "__all" && empresaMap.get(h.linha) !== f.empresa) return false;
      if (f.grupo !== "__all" && !grupoParaLinhas.get(f.grupo)?.has(h.linha)) return false;
      return true;
    });
  }, [historico, f, empresaMap, grupoParaLinhas]);

  const totalReprog = filtered.length;
  const linhasUnicas = new Set(filtered.map((h) => h.linha)).size;
  const ativas = filtered.filter((h) => h.ativo).length;
  const esteAno = filtered.filter((h) => h.vigencia?.slice(0, 4) === String(new Date().getFullYear())).length;

  const porMesAno = useMemo(() => {
    const map = new Map<string, Record<string, string | number>>();
    const anosSet = new Set<string>();
    for (const h of filtered) {
      if (!h.vigencia) continue;
      const ano = h.vigencia.slice(0, 4);
      const mes = Number(h.vigencia.slice(5, 7)) - 1;
      anosSet.add(ano);
      const key = MESES[mes];
      const row = map.get(key) ?? { mes: key };
      row[ano] = ((row[ano] as number) ?? 0) + 1;
      map.set(key, row);
    }
    const rows = MESES.map((m) => map.get(m) ?? { mes: m });
    return { rows, anos: Array.from(anosSet).sort() };
  }, [filtered]);

  const topLinhas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of filtered) counts.set(h.linha, (counts.get(h.linha) ?? 0) + 1);
    return Array.from(counts, ([linha, total]) => ({ linha, total })).sort((a, b) => b.total - a.total).slice(0, 8);
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2"><Link to="/historico-consultar"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Resumo — Reprogramações</h1>
        </div>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3"><CardTitle className="text-base">Filtros do painel</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Input placeholder="Linha" value={f.linha} onChange={(e) => setF((s) => ({ ...s, linha: e.target.value }))} />
          <Select value={f.ano} onValueChange={(v) => setF((s) => ({ ...s, ano: v }))}>
            <SelectTrigger><SelectValue placeholder="Ano" /></SelectTrigger>
            <SelectContent><SelectItem value="__all">Todos os anos</SelectItem>{opts.ano.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={f.mes} onValueChange={(v) => setF((s) => ({ ...s, mes: v }))}>
            <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos os meses</SelectItem>
              {["01","02","03","04","05","06","07","08","09","10","11","12"].map((m, i) => <SelectItem key={m} value={m}>{MESES[i]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={f.dia_tipo} onValueChange={(v) => setF((s) => ({ ...s, dia_tipo: v }))}>
            <SelectTrigger><SelectValue placeholder="Dia tipo" /></SelectTrigger>
            <SelectContent><SelectItem value="__all">Todos</SelectItem>{opts.diaTipo.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={f.empresa} onValueChange={(v) => setF((s) => ({ ...s, empresa: v }))}>
            <SelectTrigger><SelectValue placeholder="Empresa" /></SelectTrigger>
            <SelectContent><SelectItem value="__all">Todas</SelectItem>{opts.empresa.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={f.grupo} onValueChange={(v) => setF((s) => ({ ...s, grupo: v }))}>
            <SelectTrigger><SelectValue placeholder="Grupo de Linha" /></SelectTrigger>
            <SelectContent><SelectItem value="__all">Todos</SelectItem>{opts.grupo.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={Activity} label="Total de reprogramações" value={totalReprog} />
        <Kpi icon={Bus} label="Linhas únicas afetadas" value={linhasUnicas} />
        <Kpi icon={TrendingUp} label="Ativas" value={ativas} />
        <Kpi icon={Calendar} label={`Em ${new Date().getFullYear()}`} value={esteAno} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader><CardTitle className="text-sm">Reprogramações por mês/ano</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porMesAno.rows} margin={{ top: 20, right: 8, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                {porMesAno.anos.map((ano, i) => (
                  <Bar key={ano} dataKey={ano} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader><CardTitle className="text-sm">Linhas com mais reprogramações</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topLinhas} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="linha" width={60} />
                <Tooltip />
                <Bar dataKey="total" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs"><Icon className="h-4 w-4" /> {label}</div>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
