// Diálogo único de exportação/impressão de PDF: escolha de orientação
// (Retrato / Paisagem), pré-visualização embutida e ações Baixar / Imprimir.
// Reaproveitado por todos os relatórios — cada tela passa apenas a função
// que constrói o documento jsPDF para a orientação escolhida.

import { useCallback, useEffect, useState } from "react";
import type jsPDF from "jspdf";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileText, Printer, Download, RefreshCw } from "lucide-react";

export type PdfOrientation = "portrait" | "landscape";

export function PdfPreviewDialog({
  build,
  filename,
  disabled,
  defaultOrientation = "portrait",
  onDownload,
  onPrint,
  triggerLabel = "PDF / Imprimir",
}: {
  build: (orientation: PdfOrientation) => jsPDF;
  filename: string;
  disabled?: boolean;
  defaultOrientation?: PdfOrientation;
  onDownload?: (o: PdfOrientation) => void;
  onPrint?: (o: PdfOrientation) => void;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [orientation, setOrientation] = useState<PdfOrientation>(defaultOrientation);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(() => {
    setBusy(true);
    try {
      const doc = build(orientation);
      const blobUrl = doc.output("bloburl") as unknown as string;
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return String(blobUrl);
      });
    } catch (err: any) {
      console.error("Erro ao gerar PDF:", err);
      toast.error("Erro ao gerar o PDF: " + (err?.message ?? "desconhecido"));
    } finally {
      setBusy(false);
    }
  }, [build, orientation]);

  useEffect(() => {
    if (!open) return;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orientation]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  function handleDownload() {
    try {
      build(orientation).save(filename);
      onDownload?.(orientation);
    } catch (err: any) {
      toast.error("Erro ao gerar o PDF: " + (err?.message ?? "desconhecido"));
    }
  }

  function handlePrint() {
    if (!url) return;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, "_blank");
      }
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
    onPrint?.(orientation);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <FileText className="h-4 w-4 mr-1" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col gap-3">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-base">Pré-visualizar e exportar PDF</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            <Button
              variant={orientation === "portrait" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOrientation("portrait")}
            >
              Retrato
            </Button>
            <Button
              variant={orientation === "landscape" ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOrientation("landscape")}
            >
              Paisagem
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={generate} disabled={busy}>
            <RefreshCw className={`h-4 w-4 mr-1 ${busy ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={!url}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir
            </Button>
            <Button size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" /> Baixar PDF
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 rounded-md border bg-muted/30 overflow-hidden">
          {url ? (
            <iframe title="Pré-visualização do PDF" src={url} className="w-full h-full" />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Gerando pré-visualização…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
