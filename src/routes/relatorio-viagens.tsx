import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { ModuleNav } from "@/components/module-nav";
import { toast } from "sonner";
import fileSaver from "file-saver";
const { saveAs } = fileSaver;
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  buildTxt,
  encodeWindows1252,
  sortRecords,
  type ProcessedRecord,
} from "@/lib/excel-to-txt";
import { processCsvFile } from "@/lib/csv-to-txt";
import {
  FileText,
  Upload,
  Trash2,
  Play,
  Download,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface FileMessage {
  fileName: string;
  type: "error" | "warning";
  message: string;
}

export const Route = createFileRoute("/relatorio-viagens")({
  head: () => ({
    meta: [
      { title: "Módulo 2 — Relat. Viagens FLITS - QSTI | Gestão e Análise de Dados" },
      {
        name: "description",
        content:
          "Importe o relatório de viagens realizadas em CSV e gere o TXT de importação automaticamente.",
      },
      { property: "og:title", content: "Módulo 2 — Relat. Viagens FLITS - QSTI" },
      {
        property: "og:description",
        content:
          "Importe o relatório de viagens realizadas em CSV e gere o TXT de importação automaticamente.",
      },
    ],
  }),
  component: RelatorioViagens,
});

function RelatorioViagens() {
  const [files, setFiles] = useState<File[]>([]);
  const [records, setRecords] = useState<ProcessedRecord[]>([]);
  const [messages, setMessages] = useState<FileMessage[]>([]);
  const [filesWithError, setFilesWithError] = useState<Set<string>>(new Set());
  const [splitByDate, setSplitByDate] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const addFiles = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list).filter((f) => /\.csv$/i.test(f.name));
    setFiles((prev) => {
      const seen = new Set(prev.map((p) => p.name + p.size));
      const merged = [...prev];
      for (const f of arr) if (!seen.has(f.name + f.size)) merged.push(f);
      return merged;
    });
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragRef.current?.classList.remove("ring-2", "ring-primary");
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const handleProcess = async () => {
    if (!files.length) return;
    setProcessing(true);
    setProgress(0);
    setRecords([]);
    setMessages([]);
    setFilesWithError(new Set());
    setShowSuccess(false);
    setProcessedCount(0);
    const all: ProcessedRecord[] = [];
    const msgs: FileMessage[] = [];
    const errored = new Set<string>();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const res = await processCsvFile(f);
      if (res.error) {
        msgs.push({ fileName: f.name, type: "error", message: res.error });
        errored.add(f.name);
      }
      for (const w of res.warnings) {
        msgs.push({ fileName: f.name, type: "warning", message: w });
      }
      all.push(...res.records);
      setProgress(Math.round(((i + 1) / files.length) * 100));
      setProcessedCount(i + 1);
    }
    const sorted = sortRecords(all);
    setRecords(sorted);
    setMessages(msgs);
    setFilesWithError(errored);
    setProcessing(false);

    const errorCount = msgs.filter((m) => m.type === "error").length;
    const warnCount = msgs.filter((m) => m.type === "warning").length;
    if (errorCount > 0) {
      toast.error(`${errorCount} arquivo(s) com erro`, {
        description: "Verifique os detalhes abaixo antes de gerar o TXT.",
      });
    } else if (sorted.length === 0) {
      toast.error("Nenhum registro válido encontrado.");
    } else if (warnCount > 0) {
      toast.warning(`Processado com ${warnCount} aviso(s)`, {
        description: `${sorted.length} registro(s) prontos.`,
      });
      setShowSuccess(true);
    } else {
      toast.success(`${sorted.length} registro(s) processado(s)`, {
        description: `${files.length} arquivo(s) sem erros.`,
      });
      setShowSuccess(true);
    }
  };

  const handleExport = () => {
    if (!records.length) return;
    if (splitByDate) {
      const groups = new Map<string, ProcessedRecord[]>();
      for (const r of records) {
        const arr = groups.get(r.dataSort) ?? [];
        arr.push(r);
        groups.set(r.dataSort, arr);
      }
      for (const [dataSort, recs] of groups) {
        const bytes = encodeWindows1252(buildTxt(recs));
        saveAs(
          new Blob([bytes as BlobPart], { type: "text/plain;charset=windows-1252" }),
          `exportacao_${dataSort}.txt`,
        );
      }
      toast.success(`${groups.size} arquivo(s) gerado(s) por data.`);
      return;
    }
    const bytes = encodeWindows1252(buildTxt(records));
    saveAs(
      new Blob([bytes as BlobPart], { type: "text/plain;charset=windows-1252" }),
      "exportacao.txt",
    );
  };

  const handleClear = () => {
    setFiles([]);
    setRecords([]);
    setMessages([]);
    setFilesWithError(new Set());
    setShowSuccess(false);
    setProgress(0);
    setProcessedCount(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  const preview = useMemo(() => records.slice(0, 200), [records]);

  return (
    <div>
        <ModuleNav active="relatorio-viagens" />

        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            Módulo 2 — Relat. Viagens FLITS - QSTI
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Importe o relatório de viagens realizadas (.csv). O app identifica LINHA, DATA, SENTIDO,
            PREFIXO e horários automaticamente e gera o TXT no mesmo layout de importação.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Arquivos CSV</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                ref={dragRef}
                onDragOver={(e) => {
                  e.preventDefault();
                  dragRef.current?.classList.add("ring-2", "ring-primary");
                }}
                onDragLeave={() => dragRef.current?.classList.remove("ring-2", "ring-primary")}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 p-10 text-center transition-colors hover:bg-muted/50"
              >
                <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Arraste arquivos .csv aqui</p>
                <p className="text-xs text-muted-foreground">ou clique para selecionar</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
              </div>

              {files.length > 0 && (
                <div className="rounded-lg border border-border">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
                    <span className="font-medium">{files.length} arquivo(s)</span>
                    <Button variant="ghost" size="sm" onClick={handleClear}>
                      <Trash2 className="mr-1 h-4 w-4" />
                      Limpar
                    </Button>
                  </div>
                  <ul className="max-h-48 divide-y divide-border overflow-auto text-sm">
                    {files.map((f) => {
                      const hasError = filesWithError.has(f.name);
                      return (
                        <li
                          key={f.name + f.size}
                          className={`flex items-center gap-2 px-4 py-2 ${hasError ? "bg-destructive/10" : ""}`}
                        >
                          {hasError ? (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span
                            className={`truncate ${hasError ? "font-medium text-destructive" : ""}`}
                          >
                            {f.name}
                          </span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {(f.size / 1024).toFixed(1)} KB
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-muted p-3 text-center">
                  <div className="text-xs text-muted-foreground">Arquivos</div>
                  <div className="text-lg font-semibold">{files.length}</div>
                </div>
                <div className="rounded-md bg-muted p-3 text-center">
                  <div className="text-xs text-muted-foreground">Registros</div>
                  <div className="text-lg font-semibold">{records.length}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-border p-3">
                <Checkbox
                  id="splitByDateCsv"
                  checked={splitByDate}
                  onCheckedChange={(v) => setSplitByDate(v === true)}
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="splitByDateCsv" className="cursor-pointer">
                    Exportar por data
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Gera um arquivo TXT separado para cada data.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Button onClick={handleProcess} disabled={processing || !files.length}>
                  <Play className="mr-2 h-4 w-4" />
                  {processing ? "Processando..." : "Processar"}
                </Button>
                <Button onClick={handleExport} disabled={!records.length} variant="secondary">
                  <Download className="mr-2 h-4 w-4" />
                  {splitByDate ? "Gerar TXTs por data" : "Gerar TXT"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {(processing || progress > 0) && (
          <div className="mt-6 space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progresso</span>
              <span>
                {processedCount} / {files.length}
              </span>
            </div>
            <Progress value={progress} />
          </div>
        )}

        {showSuccess && messages.length === 0 && records.length > 0 && (
          <Alert className="mt-6 border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              {records.length.toLocaleString("pt-BR")} registro(s) processado(s) sem erros. Pronto
              para gerar o TXT.
            </AlertDescription>
          </Alert>
        )}

        {messages.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="text-sm font-semibold">
              {messages.filter((m) => m.type === "error").length} erro(s) ·{" "}
              {messages.filter((m) => m.type === "warning").length} aviso(s)
            </div>
            {messages.map((m, i) => (
              <Alert
                key={i}
                variant={m.type === "error" ? "destructive" : "default"}
                className={
                  m.type === "warning"
                    ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300"
                    : ""
                }
              >
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {m.fileName && <strong className="mr-1">{m.fileName}:</strong>}
                  {m.message}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {records.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">
                Pré-visualização ({records.length.toLocaleString("pt-BR")} registros
                {records.length > preview.length ? ` — exibindo primeiros ${preview.length}` : ""})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[480px] overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Linha</TableHead>
                      <TableHead>Sentido</TableHead>
                      <TableHead>Carro</TableHead>
                      <TableHead>Partida</TableHead>
                      <TableHead>Chegada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{r.data}</TableCell>
                        <TableCell className="font-mono text-xs">{r.linha}</TableCell>
                        <TableCell className="font-mono text-xs">{r.sentido}</TableCell>
                        <TableCell className="font-mono text-xs">{r.carro}</TableCell>
                        <TableCell className="font-mono text-xs">{r.partida}</TableCell>
                        <TableCell className="font-mono text-xs">{r.chegada}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
  );
}
