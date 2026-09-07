import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchLinhas, fetchKm, fetchImportacoesComErro } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import { buildKmMaps } from "@/lib/km";
import { runVerificacaoIntegridade, type AlertaIntegridade, type Severidade } from "@/lib/integridade";
import { fetchRealizado } from "@/lib/viagens-realizado";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, RefreshCw, Loader2, ChevronDown } from "lucide-react";
import { useAuditView } from "@/lib/use-audit-view";
import { logAudit } from "@/lib/audit";

export const Route = createFileRoute("/verificacao-integridade")({
  head: () => ({ meta: [{ title: "Verificação de Integridade — Gestão e Análise de Dados" }] }),
  component: VerificacaoIntegridadePage,
});

const SEVERIDADE_CFG: Record<Severidade, { label: string; icon: any; className: string }> = {
  critico: { label: "Crítico", icon: AlertTriangle, className: "border-destructive/40 bg-destructive/5" },
  atencao: { label: "Atenção", icon: AlertCircle, className: "border-warning/40 bg-warning/5" },
  info: { label: "Info", icon: Info, className: "border-primary/30 bg-primary/5" },
};

function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

function VerificacaoIntegridadePage() {
  useAuditView("verificacao_integridade");
  const [rodou, setRodou] = useState(false);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());

  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const kmQ = useQuery({ queryKey: ["km"], queryFn: fetchKm });
  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens, enabled: rodou });
  const importacoesQ = useQuery({ queryKey: ["importacoes-com-erro"], queryFn: fetchImportacoesComErro, enabled: rodou });
  const realizadoQ = useQuery({
    queryKey: ["viagens-realizado", daysAgoISO(30), todayISO()],
    queryFn: () => fetchRealizado(daysAgoISO(30), todayISO()),
    enabled: rodou,
  });

  const carregando = viagensQ.isLoading || importacoesQ.isLoading || realizadoQ.isLoading || linhasQ.isLoading || kmQ.isLoading;

  const kmMaps = useMemo(() => buildKmMaps(kmQ.data ?? []), [kmQ.data]);

  const alertas = useMemo((): AlertaIntegridade[] => {
    if (!rodou || carregando || !viagensQ.data) return [];
    return runVerificacaoIntegridade({
      viagens: viagensQ.data,
      linhas: linhasQ.data ?? [],
      kmMaps,
      importacoes: importacoesQ.data ?? [],
      realizado: realizadoQ.data,
    });
  }, [rodou, carregando, viagensQ.data, linhasQ.data, kmMaps, importacoesQ.data, realizadoQ.data]);

  function rodar() {
    setRodou(true);
    void logAudit({ action: "view", entity: "verificacao_integridade", details: { acao: "rodou_verificacao" } });
    viagensQ.refetch();
    importacoesQ.refetch();
    realizadoQ.refetch();
  }

  function toggle(id: string) {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const contagem = useMemo(() => ({
    critico: alertas.filter((a) => a.severidade === "critico").length,
    atencao: alertas.filter((a) => a.severidade === "atencao").length,
  }), [alertas]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Verificação de Integridade</h1>
          <p className="text-sm text-muted-foreground">
            Varredura geral nos dados já importados — KM, jornadas, viagens sem trecho, cadastro incompleto e falhas de importação.
          </p>
        </div>
        <Button onClick={rodar} disabled={carregando}>
          {carregando ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verificando...</> : <><RefreshCw className="h-4 w-4 mr-2" />{rodou ? "Verificar novamente" : "Rodar verificação"}</>}
        </Button>
      </div>

      {!rodou && (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Clique em "Rodar verificação" para escanear todas as viagens, jornadas e importações em busca de inconsistências.
            <br />Pode levar alguns segundos dependendo do volume de dados.
          </CardContent>
        </Card>
      )}

      {rodou && !carregando && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card className="shadow-[var(--shadow-card)] border-destructive/30">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div><p className="text-2xl font-bold tabular-nums">{contagem.critico}</p><p className="text-xs text-muted-foreground">Alertas críticos</p></div>
              </CardContent>
            </Card>
            <Card className="shadow-[var(--shadow-card)] border-warning/30">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertCircle className="h-8 w-8 text-warning" />
                <div><p className="text-2xl font-bold tabular-nums">{contagem.atencao}</p><p className="text-xs text-muted-foreground">Pontos de atenção</p></div>
              </CardContent>
            </Card>
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="p-4 flex items-center gap-3">
                <Info className="h-8 w-8 text-muted-foreground" />
                <div><p className="text-2xl font-bold tabular-nums">{viagensQ.data?.length.toLocaleString("pt-BR") ?? 0}</p><p className="text-xs text-muted-foreground">Viagens escaneadas</p></div>
              </CardContent>
            </Card>
          </div>

          {alertas.length === 0 ? (
            <Card className="shadow-[var(--shadow-card)] border-success/30">
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-2" />
                <p className="text-sm font-medium">Nenhuma inconsistência encontrada.</p>
                <p className="text-xs text-muted-foreground mt-1">Todos os pontos verificados estão OK.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {alertas.map((a) => {
                const cfg = SEVERIDADE_CFG[a.severidade];
                const Icon = cfg.icon;
                const aberto = expandido.has(a.id);
                return (
                  <Card key={a.id} className={`shadow-[var(--shadow-card)] ${cfg.className}`}>
                    <CardHeader className="pb-2 cursor-pointer" onClick={() => toggle(a.id)}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0" />
                          <CardTitle className="text-sm font-semibold">{a.titulo}</CardTitle>
                          <Badge variant="outline" className="text-[10px]">{a.categoria}</Badge>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="secondary">{a.quantidade.toLocaleString("pt-BR")}</Badge>
                          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-xs text-muted-foreground">{a.descricao}</p>
                      {aberto && (
                        <ul className="mt-3 space-y-1 text-xs border-t border-border/60 pt-2 max-h-64 overflow-y-auto">
                          {a.amostra.map((linha, i) => <li key={i} className="text-muted-foreground">• {linha}</li>)}
                          {a.quantidade > a.amostra.length && (
                            <li className="text-muted-foreground italic">…e mais {a.quantidade - a.amostra.length} caso(s)</li>
                          )}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
