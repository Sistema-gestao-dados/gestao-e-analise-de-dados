import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileUp, CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parseTxt } from "@/lib/txt-import";
import { Link } from "@tanstack/react-router";
import { logAudit } from "@/lib/audit";
import { DiaTipoMapper, detectarNovosDiasTipo, aplicarHerancaConhecida, type DiaTipoNovo } from "@/components/dia-tipo-mapper";
import { ativarVersao } from "@/lib/projeto-ativo";
import { useAuditView } from "@/lib/use-audit-view";
import { usePersistentState } from "@/hooks/use-persistent-state";

const DIAS_TIPO_BASE = ["Dias úteis", "Sábado", "Domingo"];
const NOVO_SENTINEL = "__novo__";

export const Route = createFileRoute("/importacao-txt")({
  head: () => ({ meta: [{ title: "Importação TXT GPS — Gestão e Análise de Dados" }] }),
  component: ImportTxtPage,
});

type FileReport = {
  name: string;
  rows: number;
  inserted: number;
  errors: { line: number; reason: string }[];
  status: "done" | "error";
};

function ImportTxtPage() {
  useAuditView("importacao_txt");
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [marcarAtivo, setMarcarAtivo] = usePersistentState("importacao.marcarAtivo", false);
  const [novosDias, setNovosDias] = useState<DiaTipoNovo[]>([]);
  const [showWizard, setShowWizard] = useState(false);

  // Sobrescrever dia tipo: por padrão essa tela usa o que já vem escrito no
  // arquivo (coluna "Tipo Op."). Só liga isso quando precisa forçar um dia
  // tipo específico/novo (ex.: um feriado que o arquivo não rotula sozinho).
  const [sobrescreverDiaTipo, setSobrescreverDiaTipo] = useState(false);
  const [diaTipo, setDiaTipo] = useState<string>("");
  const [novoDiaTipo, setNovoDiaTipo] = useState<string>("");
  const [criandoNovo, setCriandoNovo] = useState(false);
  const diaTipoEfetivo = criandoNovo ? novoDiaTipo.trim() : diaTipo;

  const { data: diasCadastrados = DIAS_TIPO_BASE } = useQuery({
    queryKey: ["dias-tipo-cadastrados"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("parametro_multilinha").select("tipo_dia");
      const existentes = new Set<string>(DIAS_TIPO_BASE);
      for (const r of (data ?? []) as any[]) if (r.tipo_dia) existentes.add(r.tipo_dia);
      const extras = Array.from(existentes).filter((d) => !DIAS_TIPO_BASE.includes(d)).sort();
      return [...DIAS_TIPO_BASE, ...extras];
    },
  });

  function onSelectDiaTipo(v: string) {
    if (v === NOVO_SENTINEL) {
      setCriandoNovo(true);
      setDiaTipo("");
      return;
    }
    setCriandoNovo(false);
    setNovoDiaTipo("");
    setDiaTipo(v);
  }

  // Deixa criar/associar o dia tipo a um pai ANTES de importar qualquer
  // arquivo — abre o mesmo wizard, mas sem lista de linhas (só grava o pai
  // em dia_tipo_heranca). Toda importação futura desse dia tipo já herda
  // o grupo de linha automaticamente, sem perguntar de novo.
  function definirDiaTipoAgora() {
    if (!diaTipoEfetivo) { toast.error("Digite ou escolha o nome do dia tipo primeiro"); return; }
    if (DIAS_TIPO_BASE.includes(diaTipoEfetivo)) { toast.error("Dias úteis, Sábado e Domingo já são conhecidos — não precisam desse passo"); return; }
    setNovosDias([{ nome: diaTipoEfetivo, linhas: [] }]);
    setShowWizard(true);
  }

  async function handleFiles(files: FileList) {
    if (sobrescreverDiaTipo && !diaTipoEfetivo) {
      toast.error(criandoNovo ? "Digite o nome do novo dia tipo" : "Escolha um dia tipo, ou desligue \"Sobrescrever\"");
      return;
    }
    setBusy(true);
    const newReports: FileReport[] = [];
    const versoesImportadas = new Set<string>();
    const parsedAll: { linha: string; tipo_operacao: string | null }[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const { rows, errors } = parseTxt(text);
        if (sobrescreverDiaTipo && diaTipoEfetivo) {
          for (const r of rows) r.tipo_operacao = diaTipoEfetivo;
        }
        const payload = rows.map((r) => ({ ...r, arquivo: file.name }));
        parsedAll.push(...rows.map((r) => ({ linha: r.linha, tipo_operacao: r.tipo_operacao })));
        for (const r of rows) if (r.versao_programacao) versoesImportadas.add(r.versao_programacao);
        let inserted = 0;
        let duplicadas = 0;
        const insertErrors: string[] = [];
        const chunkSize = 500;
        for (let i = 0; i < payload.length; i += chunkSize) {
          const chunk = payload.slice(i, i + chunkSize);
          // Ignora viagens idênticas já existentes (reimportação do mesmo arquivo)
          const { data, error } = await (supabase as any)
            .from("viagens")
            .upsert(chunk, { onConflict: "dedupe_key", ignoreDuplicates: true })
            .select("id");
          if (error) insertErrors.push(error.message);
          else {
            const n = (data ?? []).length;
            inserted += n;
            duplicadas += chunk.length - n;
          }
        }

        const allErrors = [
          ...errors,
          ...insertErrors.map((m, idx) => ({ line: -1 - idx, reason: m })),
        ];
        await supabase.from("importacoes").insert({
          tipo: "Viagens TXT (GPS)",
          arquivo: file.name,
          registros_inseridos: inserted,
          registros_atualizados: duplicadas,
          registros_erro: allErrors.length,
        });
        void logAudit({ action: "import", entity: "viagens", details: { tipo: "TXT GPS", arquivo: file.name, inserted, duplicadas, erros: allErrors.length, diaTipoSobrescrito: sobrescreverDiaTipo ? diaTipoEfetivo : null } });
        newReports.push({
          name: file.name,
          rows: rows.length,
          inserted,
          errors: allErrors,
          status: insertErrors.length ? "error" : "done",
        });
        if (insertErrors.length) toast.error(`${file.name}: ${insertErrors.length} erro(s) ao salvar`);
        else if (duplicadas) toast.success(`${file.name}: ${inserted} novo(s), ${duplicadas} duplicada(s) ignorada(s)`);
        else toast.success(`${file.name}: ${inserted} registro(s) importado(s)`);

      } catch (e: any) {
        newReports.push({ name: file.name, rows: 0, inserted: 0, errors: [{ line: 0, reason: e?.message ?? "Falha ao ler arquivo" }], status: "error" });
        toast.error(`${file.name}: ${e?.message ?? "Falha"}`);
      }
    }
    setReports((prev) => [...newReports, ...prev]);
    if (marcarAtivo && versoesImportadas.size) {
      try {
        let total = 0;
        for (const v of versoesImportadas) {
          const { count } = await ativarVersao(v);
          total += count;
        }
        if (total) toast.success(`${total} combinação(ões) linha/dia marcadas como ativas`);
      } catch (e: any) {
        toast.error(`Falha ao marcar ativos: ${e?.message ?? "erro"}`);
      }
    }
    try {
      const novos = await detectarNovosDiasTipo(parsedAll);
      const semPai = await aplicarHerancaConhecida(novos);
      if (semPai.length) { setNovosDias(semPai); setShowWizard(true); }
    } catch { /* silencioso */ }
    qc.invalidateQueries({ queryKey: ["viagens"] });
    qc.invalidateQueries({ queryKey: ["importacoes"] });
    qc.invalidateQueries({ queryKey: ["projetos-ativos"] });
    qc.invalidateQueries({ queryKey: ["multi"] });
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Importação TXT — GPS Cittati</h1>
          <p className="text-sm text-muted-foreground">
            Anexe arquivos TXT separados por <span className="font-mono">;</span>. Os registros são adicionados (sem apagar os anteriores).
          </p>
        </div>
        <Button variant="outline" asChild size="sm">
          <Link to="/viagens">Ver Viagens <ArrowRight className="h-4 w-4 ml-1" /></Link>
        </Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileUp className="h-4 w-4 text-primary" /> Selecionar arquivo(s) TXT
          </CardTitle>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {["Linha", "Tipo Op.", "Versão", "Serviço/Turno", "Origem", "Destino", "Movimento", "Sentido", "Partida", "Chegada", "Tempo"].map((c) => (
              <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <Checkbox checked={sobrescreverDiaTipo} onCheckedChange={(v) => setSobrescreverDiaTipo(!!v)} />
            Sobrescrever o Dia Tipo do arquivo (força um dia tipo específico, ou cria um novo)
          </label>
          {sobrescreverDiaTipo && (
            <div className="max-w-xs space-y-1.5 border rounded-md p-3 bg-muted/20">
              <label className="text-xs font-medium text-muted-foreground">
                Dia tipo deste arquivo <span className="text-destructive">*</span>
              </label>
              <Select value={criandoNovo ? NOVO_SENTINEL : diaTipo} onValueChange={onSelectDiaTipo}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Escolha um dia tipo cadastrado" />
                </SelectTrigger>
                <SelectContent>
                  {diasCadastrados.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  <SelectItem value={NOVO_SENTINEL} className="text-primary">+ Criar novo dia tipo...</SelectItem>
                </SelectContent>
              </Select>
              {criandoNovo && (
                <Input
                  autoFocus
                  placeholder="Ex.: Feriado 7 de Setembro"
                  value={novoDiaTipo}
                  onChange={(e) => setNovoDiaTipo(e.target.value)}
                  className="h-9"
                />
              )}
              <p className="text-[11px] text-muted-foreground">
                Aplica esse dia tipo em todas as viagens do(s) arquivo(s), ignorando o que estiver na coluna
                "Tipo Op." do TXT. Um dia tipo novo abre, ao final da importação, a tela pra você dizer de qual
                dia tipo ele deve herdar os grupos de linha já cadastrados.
              </p>
              {diaTipoEfetivo && !DIAS_TIPO_BASE.includes(diaTipoEfetivo) && (
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs w-full" onClick={definirDiaTipoAgora}>
                  Definir de qual dia herdar agora, sem importar arquivo
                </Button>
              )}
            </div>
          )}
          <input
            ref={ref}
            type="file"
            accept=".txt"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => ref.current?.click()} disabled={busy || (sobrescreverDiaTipo && !diaTipoEfetivo)} className="w-full sm:w-auto">
              {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando...</> : <><Upload className="h-4 w-4 mr-2" />Selecionar TXT (múltiplos)</>}
            </Button>
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <Checkbox checked={marcarAtivo} onCheckedChange={(v) => setMarcarAtivo(!!v)} />
              Marcar como <strong>ativo</strong> após importar (substitui a versão anterior das mesmas combinações linha/dia)
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Linhas inválidas são ignoradas individualmente sem interromper a importação. Tempo de viagem é calculado automaticamente, inclusive virada de dia.
          </p>
        </CardContent>
      </Card>

      <DiaTipoMapper novos={novosDias} open={showWizard} onClose={() => { setShowWizard(false); setNovosDias([]); }} />

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
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted-foreground">Inseridos</div><div className="font-semibold text-success">{r.inserted}</div></div>
                  <div><div className="text-muted-foreground">Lidos</div><div className="font-semibold text-primary">{r.rows}</div></div>
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
