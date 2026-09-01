import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import fileSaver from "file-saver";
const { saveAs } = fileSaver;
import { ModuleNav } from "@/components/module-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  convertRows,
  buildTxt,
  buildTxtFile,
  type ConversionResult,
  type ConvertedRow,
} from "@/lib/bi-cittati";
import { encodeWindows1252 } from "@/lib/excel-to-txt";
import {
  FileSpreadsheet,
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/bi-cittati")({
  head: () => ({
    meta: [
      { title: "Módulo 1 — BI Cittati - QSTI | Gestão e Análise de Dados" },
      {
        name: "description",
        content:
          "Converta planilhas Excel de viagens do BI CITTATI para o arquivo TXT no modelo QSTI, com prévia e validação linha a linha.",
      },
      { property: "og:title", content: "Módulo 1 — BI Cittati - QSTI" },
      {
        property: "og:description",
        content:
          "Importe a planilha, confira a prévia e baixe o TXT no formato exigido pelo sistema QSTI.",
      },
    ],
  }),
  component: BiCittati,
});

function BiCittati() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [splitByDate, setSplitByDate] = useState(false);

  const handleSelect = (f: File | null) => {
    setFile(f);
    setResult(null);
    setFatal(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleSelect(f);
  };

  const convert = async () => {
    if (!file) return;
    setBusy(true);
    setFatal(null);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("Planilha vazia.");
      const sheet = wb.Sheets[sheetName]!;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        blankrows: false,
        defval: "",
      });
      const res = convertRows(rows);
      setResult(res);
      if (res.errors.length > 0) {
        toast.error(`${res.errors.length} linha(s) com erro`, {
          description: "Verifique os detalhes abaixo antes de gerar o TXT.",
        });
      } else if (res.records.length === 0) {
        toast.error("Nenhum registro válido encontrado.");
      } else {
        toast.success(`${res.records.length} registro(s) convertido(s)`, {
          description: `${res.totalRows} linha(s) processada(s) sem erros.`,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não foi possível ler o arquivo Excel.";
      setFatal(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const baseFileName = (file?.name ?? "dados").replace(/\.(xlsx|xls)$/i, "");

  const download = () => {
    if (!result || result.records.length === 0) return;

    if (splitByDate) {
      const groups = new Map<string, ConvertedRow[]>();
      for (const r of result.records) {
        const arr = groups.get(r.date) ?? [];
        arr.push(r);
        groups.set(r.date, arr);
      }
      for (const [date, recs] of groups) {
        const bytes = encodeWindows1252(buildTxtFile(recs));
        saveAs(
          new Blob([bytes as BlobPart], { type: "text/plain;charset=windows-1252" }),
          `${baseFileName}_${date}.txt`,
        );
      }
      toast.success(`${groups.size} arquivo(s) gerado(s) por data.`);
      return;
    }

    const bytes = encodeWindows1252(buildTxtFile(result.records));
    saveAs(
      new Blob([bytes as BlobPart], { type: "text/plain;charset=windows-1252" }),
      `${baseFileName}.txt`,
    );
  };

  return (
    <div>
        <ModuleNav active="bi-cittati" />

        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Módulo 1 — BI Cittati - QSTI</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Converta a planilha Excel de viagens do BI CITTATI para o TXT no modelo QSTI.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Arquivo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 p-10 text-center transition-colors hover:bg-muted/50"
              >
                <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Arraste a planilha .xlsx aqui</p>
                <p className="text-xs text-muted-foreground">ou clique para selecionar</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => handleSelect(e.target.files?.[0] ?? null)}
                />
              </div>

              {file && (
                <div className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ações</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md bg-muted p-3 text-center">
                  <div className="text-xs text-muted-foreground">Linhas</div>
                  <div className="text-lg font-semibold">{result?.totalRows ?? 0}</div>
                </div>
                <div className="rounded-md bg-muted p-3 text-center">
                  <div className="text-xs text-muted-foreground">Registros</div>
                  <div className="text-lg font-semibold">{result?.records.length ?? 0}</div>
                </div>
                <div className="rounded-md bg-muted p-3 text-center">
                  <div className="text-xs text-muted-foreground">Erros</div>
                  <div className="text-lg font-semibold">{result?.errors.length ?? 0}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-border p-3">
                <Checkbox
                  id="splitByDateBiCittati"
                  checked={splitByDate}
                  onCheckedChange={(v) => setSplitByDate(v === true)}
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="splitByDateBiCittati" className="cursor-pointer">
                    Exportar por data
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Gera um arquivo TXT separado para cada data.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={convert} disabled={!file || busy}>
                  {busy ? "Convertendo..." : "Converter para TXT"}
                </Button>
                <Button
                  onClick={download}
                  disabled={!result || result.records.length === 0}
                  variant="secondary"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {splitByDate ? "Gerar TXTs por data" : "Baixar TXT"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {fatal && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{fatal}</AlertDescription>
          </Alert>
        )}

        {result && result.errors.length === 0 && result.records.length > 0 && (
          <Alert className="mt-6 border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              {result.records.length.toLocaleString("pt-BR")} registro(s) convertido(s) sem erros.
              Pronto para baixar o TXT.
            </AlertDescription>
          </Alert>
        )}

        {result && result.errors.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base text-destructive">
                {result.errors.length} linha(s) com problema
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="max-h-80 space-y-2 overflow-auto text-sm">
                {result.errors.map((e) => (
                  <li key={e.excelRow} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                    <span className="font-semibold text-foreground">
                      Linha {e.excelRow} da planilha:
                    </span>{" "}
                    <span className="text-muted-foreground">{e.reason}</span>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{e.snippet}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {result && result.records.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">
                Pré-visualização do TXT ({result.records.length.toLocaleString("pt-BR")} registros)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
                {buildTxt(result.records)}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
  );
}
