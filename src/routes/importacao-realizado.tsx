import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileUp, CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parseRealizadoCsv } from "@/lib/realizado";
import { insertRealizado } from "@/lib/viagens-realizado";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";

export const Route = createFileRoute("/importacao-realizado")({
  head: () => ({ meta: [{ title: "Importação Realizado (Cittati) — Gestão e Análise de Dados" }] }),
  component: ImportRealizadoPage,
});

type FileReport = {
  name: string;
  rows: number;
  inserted: number;
  duplicadas: number;
  errors: { line: number; reason: string }[];
  status: "done" | "error";
};

function ImportRealizadoPage() {
  useAuditView("importacao_realizado");
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<FileReport[]>([]);

  async function handleFiles(files: FileList) {
    setBusy(true);
    const newReports: FileReport[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const { rows, errors, totalLinhas } = parseRealizadoCsv(text);
        if (!rows.length && errors.length) {
          newReports.push({ name: file.name, rows: totalLinhas, inserted: 0, duplicadas: 0, errors, status: "error" });
          toast.error(`${file.name}: ${errors[0]?.reason ?? "arquivo não reconhecido"}`);
          continue;
        }
        const payload = rows.map((r) => ({ ...r, arquivo: file.name }));
        const { inserted, duplicadas, errors: insertErrors } = await insertRealizado(payload);
        const allErrors = [...errors, ...insertErrors.map((m, idx) => ({ line: -1 - idx, reason: m }))];

        await supabase.from("importacoes").insert({
          tipo: "Realizado (Cittati)",
          arquivo: file.name,
          registros_inseridos: inserted,
          registros_atualizados: duplicadas,
          registros_erro: allErrors.length,
        });
        void logAudit({ action: "import", entity: "viagens_realizado", details: { arquivo: file.name, inserted, duplicadas, erros: allErrors.length } });

        newReports.push({ name: file.name, rows: rows.length, inserted, duplicadas, errors: allErrors, status: insertErrors.length ? "error" : "done" });
        if (insertErrors.length) toast.error(`${file.name}: erro ao salvar`);
        else if (duplicadas) toast.success(`${file.name}: ${inserted} novo(s), ${duplicadas} já existiam`);
        else toast.success(`${file.name}: ${inserted} viagem(ns) importada(s)`);
      } catch (e: any) {
        newReports.push({ name: file.name, rows: 0, inserted: 0, duplicadas: 0, errors: [{ line: 0, reason: e?.message ?? "Falha ao ler arquivo" }], status: "error" });
        toast.error(`${file.name}: ${e?.message ?? "Falha"}`);
      }
    }
    setReports((prev) => [...newReports, ...prev]);
    qc.invalidateQueries({ queryKey: ["viagens-realizado"] });
    qc.invalidateQueries({ queryKey: ["viagens-realizado-datas"] });
    qc.invalidateQueries({ queryKey: ["importacoes"] });
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Importação — Realizado (Cittati)</h1>
          <p className="text-sm text-muted-foreground">
            Suba o relatório "Gestão de Viagem" do Cittati (.csv), de um período já encerrado. Fica independente da escala programada — é uma foto fechada de Previsto x Realizado.
          </p>
        </div>
        <Button variant="outline" asChild size="sm">
          <Link to="/realizado">Ver Relatório <ArrowRight className="h-4 w-4 ml-1" /></Link>
        </Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileUp className="h-4 w-4 text-primary" /> Selecionar arquivo(s) .csv
          </CardTitle>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {["Empresa", "Linha", "Data", "Serviço/Turno", "Sentido", "Prev/Real Partida", "Prev/Real Chegada", "Tempo Viagem", "Passageiros"].map((c) => (
              <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={ref}
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
          />
          <Button onClick={() => ref.current?.click()} disabled={busy} className="w-full sm:w-auto">
            {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando...</> : <><Upload className="h-4 w-4 mr-2" />Selecionar CSV (múltiplos)</>}
          </Button>
          <p className="text-xs text-muted-foreground">
            Viagens já importadas antes (mesma empresa, linha, data e número) são identificadas automaticamente e não duplicam. Baixe o relatório sempre depois do período já ter encerrado — se baixar no meio do dia, viagens futuras daquele dia aparecem com "Real" vazio e seriam contadas como perdidas por engano.
          </p>
        </CardContent>
      </Card>

      {reports.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Resultados</h2>
          {reports.map((r, idx) => (
            <Card key={idx} className="shadow-[var(--shadow-card)]">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  {r.status === "done" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4 text-warning" />}
                  <span className="font-medium text-sm">{r.name}</span>
                  <Badge variant="secondary" className="ml-auto">{r.rows} linhas lidas</Badge>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div><div className="text-muted-foreground">Inseridos</div><div className="font-semibold text-success">{r.inserted}</div></div>
                  <div><div className="text-muted-foreground">Já existiam</div><div className="font-semibold text-primary">{r.duplicadas}</div></div>
                  <div><div className="text-muted-foreground">Lidos</div><div className="font-semibold">{r.rows}</div></div>
                  <div><div className="text-muted-foreground">Erros</div><div className="font-semibold text-destructive">{r.errors.length}</div></div>
                </div>
                {r.errors.slice(0, 5).map((e, i) => (
                  <div key={i} className="text-xs text-destructive">
                    {e.line > 0 ? `Linha ${e.line}: ` : ""}{e.reason}
                  </div>
                ))}
                {r.errors.length > 5 && (
                  <div className="text-xs text-muted-foreground">…e mais {r.errors.length - 5} erro(s)</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
