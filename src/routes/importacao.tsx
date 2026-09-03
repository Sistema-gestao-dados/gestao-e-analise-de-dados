import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, FileDown, Layers } from "lucide-react";
import { useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { fetchLinhas, fetchKm, fetchMulti } from "@/lib/data";
import { exportTemplateUnificado, importTemplateUnificado, type ImportReportGeral } from "@/lib/cadastro-unificado";

export const Route = createFileRoute("/importacao")({
  head: () => ({ meta: [{ title: "Importação — Gestão e Análise de Dados" }] }),
  component: ImportacaoPage,
});

type Tipo = "linha" | "km" | "multi";

const SCHEMAS: Record<Tipo, { label: string; required: string[]; table: string; map: (r: any) => any; key: string[] }> = {
  linha: {
    label: "Parâmetro Linha",
    required: ["LINHA", "EMPRESA"],
    table: "linhas",
    map: (r) => ({
      linha: String(r.LINHA ?? "").trim(),
      empresa: r.EMPRESA?.trim() || null,
      unidade: r.UNIDADE?.trim() || null,
      ordem: (r.GRUPO ?? r.ORDEM) ? String(r.GRUPO ?? r.ORDEM).trim() || null : null,
      categoria: r.CATEGORIA?.trim() || null,
    }),
    key: ["linha"],
  },
  km: {
    label: "Parâmetro KM",
    required: ["LINHA", "ORIGEM", "DESTINO", "KM"],
    table: "parametro_km",
    map: (r) => ({
      linha: String(r.LINHA ?? "").trim(),
      origem: r.ORIGEM?.trim(),
      destino: r.DESTINO?.trim(),
      km: Number(String(r.KM ?? "0").replace(",", ".")),
      descricao: r["DESCRIÇÃO"]?.trim() || r.DESCRICAO?.trim() || null,
    }),
    key: ["linha", "origem", "destino"],
  },
  multi: {
    label: "Parâmetro Multilinha",
    required: ["LINHA", "GRUPO D.U.", "TIPO DIA"],
    table: "parametro_multilinha",
    map: (r) => ({
      linha: String(r.LINHA ?? "").trim(),
      grupo_du: r["GRUPO D.U."]?.trim(),
      tipo_dia: r["TIPO DIA"]?.trim(),
    }),
    key: ["linha", "grupo_du", "tipo_dia"],
  },
};

function ImportacaoPage() {
  useAuditView("importacao");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Importação de Planilhas</h1>
        <p className="text-sm text-muted-foreground">Importe tudo de uma vez em um único arquivo, ou anexe os CSVs separados abaixo.</p>
      </div>

      <UnifiedImportCard />

      <div>
        <h2 className="text-base font-medium text-foreground mb-1">Importação separada (CSV)</h2>
        <p className="text-sm text-muted-foreground mb-3">Anexe os três arquivos (CSV). Cruzamento automático pela coluna <span className="font-semibold text-foreground">LINHA</span>.</p>
        <div className="grid gap-4 lg:grid-cols-3">
          <UploadCard tipo="linha" />
          <UploadCard tipo="km" />
          <UploadCard tipo="multi" />
        </div>
      </div>
    </div>
  );
}

function UnifiedImportCard() {
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [report, setReport] = useState<ImportReportGeral | null>(null);

  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const kmQ = useQuery({ queryKey: ["km"], queryFn: fetchKm });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });

  async function handleBaixarModelo() {
    exportTemplateUnificado({ linhas: linhasQ.data, km: kmQ.data, multi: multiQ.data });
  }

  async function handleFile(file: File) {
    setState("processing");
    setReport(null);
    try {
      const rep = await importTemplateUnificado(file);
      setReport(rep);
      setState(rep.totalErrors ? "error" : "done");

      for (const s of rep.sheets) {
        await supabase.from("importacoes").insert({
          tipo: `Cadastro Unificado — ${s.sheet}`,
          arquivo: file.name,
          registros_inseridos: s.inserted,
          registros_atualizados: s.updated,
          registros_erro: s.errors.length,
        });
        void logAudit({
          action: "import",
          entity: s.sheet.toLowerCase(),
          details: { tipo: "cadastro_unificado", arquivo: file.name, inserted: s.inserted, updated: s.updated, erros: s.errors.length },
        });
      }

      qc.invalidateQueries();
      const totalRows = rep.sheets.reduce((acc, s) => acc + s.total, 0);
      if (rep.totalErrors) toast.error(`Importação unificada: ${rep.totalErrors} erro(s)`);
      else toast.success(`Importação unificada: ${totalRows} registros processados em ${rep.sheets.length} aba(s)`);
    } catch (err: any) {
      setState("error");
      setReport({ sheets: [], totalErrors: 1 });
      toast.error(err?.message ?? "Erro ao processar arquivo");
    } finally {
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <Card className="shadow-[var(--shadow-card)] border-primary/30">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />Cadastro Unificado (Linhas + KM + Grupos)
        </CardTitle>
        <p className="text-sm text-muted-foreground">Um único arquivo Excel com 3 abas. Importe tudo de uma vez só.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleBaixarModelo} className="flex-1">
            <FileDown className="h-4 w-4 mr-2" />Baixar modelo (com dados atuais)
          </Button>
          <input
            ref={ref}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <Button onClick={() => ref.current?.click()} disabled={state === "processing"} className="flex-1">
            {state === "processing" ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando...</>
            ) : (
              <><Upload className="h-4 w-4 mr-2" />Importar arquivo Excel</>
            )}
          </Button>
        </div>

        {report && report.sheets.length > 0 && (
          <div className="rounded-md border border-border p-3 text-sm space-y-3">
            {report.sheets.map((s) => (
              <div key={s.sheet} className="space-y-1">
                <div className="flex items-center gap-2">
                  {s.errors.length ? <AlertCircle className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                  <span className="font-medium">{s.sheet}</span>
                  <span className="text-xs text-muted-foreground">({s.total} linhas)</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs pl-6">
                  <div><div className="text-muted-foreground">Inseridos</div><div className="font-semibold text-success">{s.inserted}</div></div>
                  <div><div className="text-muted-foreground">Atualizados</div><div className="font-semibold text-primary">{s.updated}</div></div>
                  <div><div className="text-muted-foreground">Erros</div><div className="font-semibold text-destructive">{s.errors.length}</div></div>
                </div>
                {s.errors.slice(0, 5).map((e, i) => <div key={i} className="text-xs text-destructive break-words pl-6">{e}</div>)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UploadCard({ tipo }: { tipo: Tipo }) {
  const schema = SCHEMAS[tipo];
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "parsing" | "saving" | "done" | "error">("idle");
  const [report, setReport] = useState<{ inserted: number; updated: number; errors: string[]; rows: number } | null>(null);

  async function handleFile(file: File) {
    setState("parsing");
    setReport(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: ";",
      complete: async (res) => {
        const headers = res.meta.fields ?? [];
        const normalized = headers.map((h) => h.replace(/^\uFEFF/, "").trim());
        const missing = schema.required.filter((r) => !normalized.includes(r));
        if (missing.length) {
          setState("error");
          setReport({ inserted: 0, updated: 0, errors: [`Colunas obrigatórias ausentes: ${missing.join(", ")}`], rows: 0 });
          return;
        }
        setState("saving");
        const errors: string[] = [];
        const allRows = (res.data as any[]).map((r) => {
          const clean: any = {};
          Object.keys(r).forEach((k) => { clean[k.replace(/^\uFEFF/, "").trim()] = typeof r[k] === "string" ? r[k].trim() : r[k]; });
          return schema.map(clean);
        }).filter((r) => r.linha);

        // dedupe by conflict key (case-insensitive), keeping the LAST occurrence
        const keyOf = (r: any) => schema.key.map((k) => String(r[k] ?? "").trim().toUpperCase()).join("|");
        const byKey = new Map<string, any>();
        const duplicateKeys = new Set<string>();
        allRows.forEach((r) => {
          const k = keyOf(r);
          if (byKey.has(k)) duplicateKeys.add(k);
          byKey.set(k, r); // last occurrence wins
        });
        const rows = Array.from(byKey.values());
        if (duplicateKeys.size) {
          errors.push(
            `${duplicateKeys.size} chave(s) duplicada(s) no arquivo (mantido o último valor de cada): ${Array.from(duplicateKeys).slice(0, 10).join(" | ")}${duplicateKeys.size > 10 ? "..." : ""}`
          );
        }

        // count existing for inserted vs updated estimate
        let updated = 0, inserted = 0;
        try {
          const { data: existing } = await supabase.from(schema.table as any).select(schema.key.join(",")).limit(10000);
          const existingKeys = new Set((existing ?? []).map((e: any) => schema.key.map((k) => e[k]).join("|").toUpperCase()));
          rows.forEach((r) => { const k = keyOf(r); if (existingKeys.has(k)) updated++; else inserted++; });
        } catch {}

        // batch upsert
        const chunkSize = 500;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const { error } = await supabase.from(schema.table as any).upsert(chunk, { onConflict: schema.key.join(",") });
          if (error) errors.push(error.message);
        }

        await supabase.from("importacoes").insert({
          tipo: schema.label,
          arquivo: file.name,
          registros_inseridos: inserted,
          registros_atualizados: updated,
          registros_erro: errors.length,
        });
        void logAudit({ action: "import", entity: schema.table, details: { tipo: schema.label, arquivo: file.name, inserted, updated, erros: errors.length } });

        qc.invalidateQueries();
        setReport({ inserted, updated, errors, rows: allRows.length });
        setState(errors.length ? "error" : "done");
        if (errors.length) toast.error(`${schema.label}: ${errors.length} erro(s)`);
        else toast.success(`${schema.label}: ${rows.length} registros processados`);
      },
      error: (err) => {
        setState("error");
        setReport({ inserted: 0, updated: 0, errors: [err.message], rows: 0 });
      },
    });
  }

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-primary" />{schema.label}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {schema.required.map((c) => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <input ref={ref} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <Button onClick={() => ref.current?.click()} disabled={state === "parsing" || state === "saving"} className="w-full">
          {state === "parsing" || state === "saving" ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando...</> : <><Upload className="h-4 w-4 mr-2" />Selecionar CSV</>}
        </Button>
        {report && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1.5">
            <div className="flex items-center gap-2">
              {state === "done" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4 text-warning" />}
              <span className="font-medium">{report.rows} linhas lidas</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><div className="text-muted-foreground">Inseridos</div><div className="font-semibold text-success">{report.inserted}</div></div>
              <div><div className="text-muted-foreground">Atualizados</div><div className="font-semibold text-primary">{report.updated}</div></div>
              <div><div className="text-muted-foreground">Erros</div><div className="font-semibold text-destructive">{report.errors.length}</div></div>
            </div>
            {report.errors.slice(0, 5).map((e, i) => <div key={i} className="text-xs text-destructive break-words">{e}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
