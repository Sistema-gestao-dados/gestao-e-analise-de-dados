import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchHistorico, buildGrupoParaLinhas, type Historico } from "@/lib/historico";
import { fetchLinhas, fetchMulti } from "@/lib/data";
import { useAuditView } from "@/lib/use-audit-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from "recharts";
import { ShieldCheck, AlertTriangle, AlertOctagon, Clock3, CalendarClock, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/historico-vigencia")({
  head: () => ({ meta: [{ title: "Controle de Vigência — Histórico de Reprogramação" }] }),
  component: VigenciaPage,
});

// Regra: uma reprogramação está "vigente" quando a vigência já começou e o
// encerramento está vazio OU ainda não chegou. Sem encerramento cadastrado
// = considerada ativa por tempo indeterminado (regra pedida pelo usuário) —
// é essa a que acompanhamos há quanto tempo está rodando.
const LIMIAR_ATENCAO_MESES = 6;
const LIMIAR_CRITICO_MESES = 12;
const JANELA_VENCIMENTO_DIAS = 90;

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

function toDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffDias(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function diffMeses(a: Date, b: Date): number {
  let meses = (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
  if (a.getDate() < b.getDate()) meses -= 1;
  return Math.max(0, meses);
}

function fmtDuracao(dias: number): string {
  if (dias >= 365) {
    const anos = Math.floor(dias / 365);
    const meses = Math.floor((dias % 365) / 30);
    return meses > 0 ? `${anos}a ${meses}m` : `${anos} ano(s)`;
  }
  if (dias >= 30) return `${Math.floor(dias / 30)} mês(es)`;
  return `${dias} dia(s)`;
}

type Severidade = "normal" | "atencao" | "critico";
const SEV_CFG: Record<Severidade, { label: string; className: string }> = {
  normal: { label: "Normal", className: "border-success/30 bg-success/10 text-success" },
  atencao: { label: "Atenção", className: "border-warning/30 bg-warning/10 text-warning" },
  critico: { label: "Crítico", className: "border-destructive/30 bg-destructive/10 text-destructive" },
};

type Vigente = {
  h: Historico;
  idadeDias: number;
  idadeMeses: number;
  severidade: Severidade;
  temFim: boolean;
  diasRestantes: number | null;
};

function VigenciaPage() {
  useAuditView("historico_reprogramacao_vigencia");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const historicoQ = useQuery({ queryKey: ["historico-reprogramacao"], queryFn: fetchHistorico });

  const linhas = linhasQ.data ?? [];
  const multi = multiQ.data ?? [];
  const historico = historicoQ.data ?? [];

  const empresaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l.empresa])), [linhas]);
  const grupoParaLinhas = useMemo(() => buildGrupoParaLinhas(multi), [multi]);

  const [f, setF] = useState({ linha: "__all", dia_tipo: "__all", grupo: "__all", empresa: "__all" });

  const opts = useMemo(() => ({
    linha: Array.from(new Set(historico.map((h) => h.linha))).sort(),
    empresa: Array.from(new Set(linhas.map((l) => l.empresa).filter(Boolean) as string[])).sort(),
    grupo: Array.from(grupoParaLinhas.keys()).sort(),
    diaTipo: Array.from(new Set(historico.map((h) => h.dia_tipo).filter(Boolean) as string[])).sort(),
  }), [historico, linhas, grupoParaLinhas]);

  const filteredBase = useMemo(() => {
    return historico.filter((h) => {
      if (f.linha !== "__all" && h.linha !== f.linha) return false;
      if (f.dia_tipo !== "__all" && h.dia_tipo !== f.dia_tipo) return false;
      if (f.empresa !== "__all" && empresaMap.get(h.linha) !== f.empresa) return false;
      if (f.grupo !== "__all" && !grupoParaLinhas.get(f.grupo)?.has(h.linha)) return false;
      return true;
    });
  }, [historico, f, empresaMap, grupoParaLinhas]);

  const vigentes = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const out: Vigente[] = [];
    for (const h of filteredBase) {
      const vig = toDate(h.vigencia);
      if (!vig || vig > hoje) continue; // sem vigência cadastrada, ou ainda não começou
      const enc = toDate(h.encerramento);
      if (enc && enc < hoje) continue; // já encerrada — não é "vigente" agora
      const idadeDias = diffDias(hoje, vig);
      const idadeMeses = diffMeses(hoje, vig);
      const temFim = !!enc;
      const severidade: Severidade =
        !temFim && idadeMeses >= LIMIAR_CRITICO_MESES ? "critico" :
        !temFim && idadeMeses >= LIMIAR_ATENCAO_MESES ? "atencao" : "normal";
      out.push({ h, idadeDias, idadeMeses, severidade, temFim, diasRestantes: enc ? diffDias(enc, hoje) : null });
    }
    return out;
  }, [filteredBase]);

  const indefinidas = useMemo(() => vigentes.filter((v) => !v.temFim), [vigentes]);
  const comPrazo = useMemo(() => vigentes.filter((v) => v.temFim), [vigentes]);

  const proximasDeVencer = useMemo(
    () => comPrazo
      .filter((v) => (v.diasRestantes ?? Infinity) <= JANELA_VENCIMENTO_DIAS)
      .sort((a, b) => (a.diasRestantes ?? 0) - (b.diasRestantes ?? 0)),
    [comPrazo],
  );

  const atencaoECritico = useMemo(
    () => indefinidas.filter((v) => v.severidade !== "normal").sort((a, b) => b.idadeDias - a.idadeDias),
    [indefinidas],
  );

  const tempoMedioDias = useMemo(() => {
    if (!vigentes.length) return 0;
    return Math.round(vigentes.reduce((s, v) => s + v.idadeDias, 0) / vigentes.length);
  }, [vigentes]);

  const porDiaTipo = useMemo(() => {
    const map = new Map<string, { dia_tipo: string; Normal: number; Atenção: number; Crítico: number }>();
    for (const v of indefinidas) {
      const key = v.h.dia_tipo ?? "Sem dia tipo";
      const row = map.get(key) ?? { dia_tipo: key, Normal: 0, Atenção: 0, Crítico: 0 };
      if (v.severidade === "normal") row.Normal += 1;
      else if (v.severidade === "atencao") row.Atenção += 1;
      else row.Crítico += 1;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => (b.Atenção + b.Crítico) - (a.Atenção + a.Crítico));
  }, [indefinidas]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2"><Link to="/historico-consultar"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Controle de Vigência</h1>
          <p className="text-sm text-muted-foreground">
            Programações em vigência (sem data de encerramento = ativa por tempo indeterminado), há quanto
            tempo estão rodando e quais têm prazo pra vencer.
          </p>
        </div>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3"><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <FiltroSelect label="Linha" value={f.linha} onChange={(v) => setF((s) => ({ ...s, linha: v }))} options={opts.linha} />
          <FiltroSelect label="Empresa" value={f.empresa} onChange={(v) => setF((s) => ({ ...s, empresa: v }))} options={opts.empresa} />
          <FiltroSelect label="Grupo de Linha" value={f.grupo} onChange={(v) => setF((s) => ({ ...s, grupo: v }))} options={opts.grupo} />
          <FiltroSelect label="Dia Tipo" value={f.dia_tipo} onChange={(v) => setF((s) => ({ ...s, dia_tipo: v }))} options={opts.diaTipo} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={ShieldCheck} label="Vigentes agora" value={vigentes.length} />
        <Kpi icon={Clock3} label="Tempo médio operando" value={fmtDuracao(tempoMedioDias)} />
        <Kpi icon={AlertTriangle} label={`Atenção (>${LIMIAR_ATENCAO_MESES}m sem prazo)`} value={indefinidas.filter((v) => v.severidade === "atencao").length} tone="atencao" />
        <Kpi icon={AlertOctagon} label={`Crítico (>${LIMIAR_CRITICO_MESES}m sem prazo)`} value={indefinidas.filter((v) => v.severidade === "critico").length} tone="critico" />
        <Kpi icon={CalendarClock} label={`Vencendo em até ${JANELA_VENCIMENTO_DIAS}d`} value={proximasDeVencer.length} tone={proximasDeVencer.length ? "atencao" : undefined} />
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader><CardTitle className="text-sm">Sem data de encerramento, por Dia Tipo</CardTitle></CardHeader>
        <CardContent>
          {porDiaTipo.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma programação vigente sem data de encerramento.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porDiaTipo} margin={{ top: 20, right: 8, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="dia_tipo" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Normal" stackId="s" fill="#16a34a" />
                <Bar dataKey="Atenção" stackId="s" fill="#f59e0b" />
                <Bar dataKey="Crítico" stackId="s" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader><CardTitle className="text-sm">Rodando há mais tempo sem data de encerramento ({atencaoECritico.length})</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {atencaoECritico.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nada em atenção ou crítico no momento.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Dia Tipo</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Rodando há</TableHead>
                  <TableHead>Severidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {atencaoECritico.map((v) => (
                  <TableRow key={v.h.id}>
                    <TableCell className="font-medium">{v.h.linha}</TableCell>
                    <TableCell>{v.h.dia_tipo ?? "—"}</TableCell>
                    <TableCell>{v.h.versao ?? "—"}</TableCell>
                    <TableCell>{fmtDate(v.h.vigencia)}</TableCell>
                    <TableCell>{fmtDuracao(v.idadeDias)}</TableCell>
                    <TableCell><Badge variant="outline" className={SEV_CFG[v.severidade].className}>{SEV_CFG[v.severidade].label}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader><CardTitle className="text-sm">Próximas de vencer — próximos {JANELA_VENCIMENTO_DIAS} dias ({proximasDeVencer.length})</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {proximasDeVencer.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma programação com encerramento previsto pra breve.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Dia Tipo</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Encerramento</TableHead>
                  <TableHead>Dias restantes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proximasDeVencer.map((v) => {
                  const dias = v.diasRestantes ?? 0;
                  const tone = dias <= 15 ? "critico" : dias <= 30 ? "atencao" : "normal";
                  return (
                    <TableRow key={v.h.id}>
                      <TableCell className="font-medium">{v.h.linha}</TableCell>
                      <TableCell>{v.h.dia_tipo ?? "—"}</TableCell>
                      <TableCell>{v.h.versao ?? "—"}</TableCell>
                      <TableCell>{fmtDate(v.h.vigencia)}</TableCell>
                      <TableCell>{fmtDate(v.h.encerramento)}</TableCell>
                      <TableCell><Badge variant="outline" className={SEV_CFG[tone].className}>{dias} dia(s)</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone?: "atencao" | "critico" }) {
  const toneClass = tone === "critico" ? "text-destructive" : tone === "atencao" ? "text-warning" : "";
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs"><Icon className="h-4 w-4" /> {label}</div>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function FiltroSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="__all">Todos</SelectItem>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
