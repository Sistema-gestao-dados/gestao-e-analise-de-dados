import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { insertHistorico, ensureDiaTipo, type HistoricoInput } from "@/lib/historico";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileUp, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/importacao-historico")({
  head: () => ({ meta: [{ title: "Importação Histórico de Reprogramação — Gestão e Análise de Dados" }] }),
  component: ImportacaoHistoricoPage,
});

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let val = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { val += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else val += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === "," || c === ";") { cur.push(val); val = ""; }
      else if (c === "\n") { cur.push(val); rows.push(cur); cur = []; val = ""; }
      else if (c === "\r") { /* skip */ }
      else val += c;
    }
  }
  if (val.length || cur.length) { cur.push(val); rows.push(cur); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!s) return null;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    const d = br[1].padStart(2, "0"), m = br[2].padStart(2, "0");
    let y = br[3]; if (y.length === 2) y = "20" + y;
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  return !isNaN(dt.getTime()) ? dt.toISOString().slice(0, 10) : null;
}

function parseAtivo(v: string | undefined): boolean {
  const s = (v ?? "").trim().toUpperCase();
  return s !== "N" && s !== "NAO" && s !== "NÃO" && s !== "FALSE" && s !== "0";
}

function ImportacaoHistoricoPage() {
  useAuditView("importacao_historico");
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function addLog(l: string) { setLog((p) => [...p, l]); }

  async function importar() {
    if (!file) return;
    setBusy(true);
    setLog([]);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) throw new Error("CSV vazio");
      const headers = rows[0].map(normalizeHeader);
      addLog(`Cabeçalhos detectados: ${headers.join(", ")}`);

      const iLinha = headers.indexOf("linha");
      const iVersao = headers.indexOf("versao");
      const iDiaTipo = headers.findIndex((h) => h === "dia_tipo" || h === "dia_tipo");
      const iDataSol = headers.findIndex((h) => h.includes("solicitacao"));
      const iVigencia = headers.indexOf("vigencia");
      const iEncerramento = headers.indexOf("encerramento");
      const iAlteracao = headers.indexOf("alteracao");
      const iAtivo = headers.indexOf("ativo");

      if (iLinha === -1) throw new Error('Coluna "Linha" não encontrada no CSV.');

      const data = rows.slice(1);
      let ok = 0, falhas = 0;
      const diaTiposNovos = new Set<string>();

      for (const r of data) {
        const linha = r[iLinha]?.trim();
        if (!linha) { falhas++; continue; }
        const diaTipo = iDiaTipo !== -1 ? r[iDiaTipo]?.trim() || null : null;
        if (diaTipo) diaTiposNovos.add(diaTipo);
        const payload: HistoricoInput = {
          linha,
          versao: iVersao !== -1 && r[iVersao]?.trim() ? Number(r[iVersao]) : null,
          dia_tipo: diaTipo,
          data_solicitacao: iDataSol !== -1 ? parseDate(r[iDataSol]) : null,
          vigencia: iVigencia !== -1 ? parseDate(r[iVigencia]) : null,
          encerramento: iEncerramento !== -1 ? parseDate(r[iEncerramento]) : null,
          alteracao: iAlteracao !== -1 ? r[iAlteracao]?.trim() || null : null,
          ativo: iAtivo !== -1 ? parseAtivo(r[iAtivo]) : true,
        };
        try {
          await insertHistorico(payload);
          ok++;
        } catch (e) {
          falhas++;
          addLog(`Erro na linha "${linha}": ${(e as Error).message}`);
        }
      }

      for (const dt of diaTiposNovos) await ensureDiaTipo(dt);

      addLog(`Concluído: ${ok} importado(s), ${falhas} com erro.`);
      void logAudit({ action: "import", entity: "historico_reprogramacao", details: { arquivo: file.name, ok, falhas } });
      qc.invalidateQueries({ queryKey: ["historico-reprogramacao"] });
      qc.invalidateQueries({ queryKey: ["historico-dia-tipos"] });
      if (ok > 0) toast.success(`${ok} registro(s) importado(s)`);
      if (falhas > 0) toast.error(`${falhas} registro(s) com erro`);
    } catch (e) {
      toast.error("Erro ao importar", { description: (e as Error).message });
      addLog(`Erro fatal: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setFile(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2"><Link to="/historico-consultar"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Importação — Histórico de Reprogramação</h1>
          <p className="text-sm text-muted-foreground">CSV com uma reprogramação por linha. A Linha precisa já existir no Cadastro de Linhas.</p>
        </div>
        <Button variant="outline" size="sm" asChild><Link to="/historico-consultar">Ver Histórico <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileUp className="h-4 w-4 text-primary" /> Selecionar CSV</CardTitle>
          <CardDescription>Colunas aceitas (cabeçalho flexível): Linha, Versão, Dia tipo, Data de solicitação, Vigência, Encerramento, Alteração, Ativo (S/N).</CardDescription>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {["Linha", "Versão", "Dia tipo", "Data de solicitação", "Vigência", "Encerramento", "Alteração", "Ativo"].map((c) => (
              <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            id="hist-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => document.getElementById("hist-file")?.click()}>
              <Upload className="h-4 w-4 mr-1" /> {file ? file.name : "Escolher arquivo"}
            </Button>
            <Button onClick={importar} disabled={!file || busy}>
              {busy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importando...</> : "Importar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="p-4 space-y-1 text-xs font-mono max-h-80 overflow-y-auto">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
