import { createFileRoute, Link } from "@tanstack/react-router";
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
import { parseTxtEasyBus } from "@/lib/txt-import-easybus";
import { logAudit } from "@/lib/audit";
import { DiaTipoMapper, detectarNovosDiasTipo, type DiaTipoNovo } from "@/components/dia-tipo-mapper";
import { ativarVersao } from "@/lib/projeto-ativo";
import { useAuditView } from "@/lib/use-audit-view";
import { usePersistentState } from "@/hooks/use-persistent-state";

export const Route = createFileRoute("/importacao-txt-easybus")({
  head: () => ({ meta: [{ title: "Importação TXT EasyBus — Gestão e Análise de Dados" }] }),
  component: ImportTxtEasyBusPage,
});

const DIAS_TIPO_BASE = ["Dias Úteis", "Sábado", "Domingo"];
const NOVO_SENTINEL = "__novo__";

type FileReport = {
  name: string;
  rows: number;
  inserted: number;
  errors: { line: number; reason: string }[];

  status: "done" | "error";
};

function ImportTxtEasyBusPage() {
  useAuditView("importacao_txt_easybus");
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<FileReport[]>([]);
  const [diaTipo, setDiaTipo] = useState<string>("");
  const [novoDiaTipo, setNovoDiaTipo] = useState<string>("");
  const [criandoNovo, setCriandoNovo] = useState(false);
  const [marcarAtivo, setMarcarAtivo] = usePersistentState("importacaoEasyBus.marcarAtivo", true);
  const [novosDias, setNovosDias] = useState<DiaTipoNovo[]>([]);
  const [showWizard, setShowWizard] = useState(false);

  // Dias tipo já cadastrados (base + qualquer um criado antes via este fluxo
  // ou pela tela de Cadastro de Grupos).
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

  const diaTipoEfetivo = criandoNovo ? novoDiaTipo.trim() : diaTipo;

  async function handleFiles(files: FileList) {
    if (!diaTipoEfetivo) {
      toast.error(criandoNovo
        ? "Digite o nome do novo dia tipo (ex.: Feriado 7 de Setembro)."
        : "Escolha o dia tipo (Dias Úteis / Sábado / Domingo / outro cadastrado) antes de importar.");
      if (ref.current) ref.current.value = "";
      return;
    }
    setBusy(true);
    const newReports: FileReport[] = [];
    const versoesImportadas = new Set<string>();
    const parsedAll: { linha: string; tipo_operacao: string | null }[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const { rows, errors } = parseTxtEasyBus(text, file.name, diaTipoEfetivo);
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
          tipo: "Viagens TXT (EasyBus)",
          arquivo: file.name,
          registros_inseridos: inserted,
          registros_atualizados: duplicadas,
          registros_erro: allErrors.length,
        });
        void logAudit({ action: "import", entity: "viagens", details: { tipo: "TXT EasyBus", arquivo: file.name, diaTipo, inserted, duplicadas, erros: allErrors.length } });
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
      if (novos.length) { setNovosDias(novos); setShowWizard(true); }
    } catch { /* silencioso */ }
    qc.invalidateQueries({ queryKey: ["viagens"] });
    qc.invalidateQueries({ queryKey: ["importacoes"] });
    qc.invalidateQueries({ queryKey: ["projetos-ativos"] });
    qc.invalidateQueries({ queryKey: ["multi"] });
    qc.invalidateQueries({ queryKey: ["dias-tipo-cadastrados"] });
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Importação TXT — EasyBus</h1>
          <p className="text-sm text-muted-foreground">
            Anexe arquivos TXT de escala do EasyBus. Os registros são adicionados (sem apagar os anteriores).
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
            {["Linha", "Tipo Op.", "Versão", "Tipo Serv.", "Serviço/Turno", "Origem", "Destino", "Movimento", "Categoria", "Sentido", "Partida", "Chegada", "Tempo"].map((c) => (
              <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-xs space-y-1.5">
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
              O layout do EasyBus não informa o dia tipo — escolha aqui (ou crie um novo, ex.: um feriado
              específico) e ele é aplicado a todas as viagens deste arquivo. Um dia tipo novo abre, ao
              final da importação, a tela para você dizer de qual dia tipo ele deve herdar os grupos de
              linha já cadastrados.
            </p>
          </div>

          <input
            ref={ref}
            type="file"
            accept=".txt"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => ref.current?.click()} disabled={busy || !diaTipoEfetivo} className="w-full sm:w-auto">
              {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando...</> : <><Upload className="h-4 w-4 mr-2" />Selecionar TXT (múltiplos)</>}
            </Button>
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <Checkbox checked={marcarAtivo} onCheckedChange={(v) => setMarcarAtivo(!!v)} />
              Marcar como <strong>ativo</strong> após importar (substitui a versão anterior das mesmas combinações linha/dia, propagando para as linhas do mesmo grupo cadastrado)
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            "Tipo Serv." (TU/DIR) é calculado automaticamente por serviço/turno: se qualquer viagem do
            grupo tiver "Intra-jorn", o grupo inteiro vira TU, senão DIR. "Versão" vem do texto entre
            parênteses no nome do arquivo. Linhas inválidas são ignoradas individualmente sem interromper
            a importação.
          </p>
        </CardContent>
      </Card>

      <DiaTipoMapper novos={novosDias} open={showWizard} onClose={() => {
        setShowWizard(false);
        setNovosDias([]);
        qc.invalidateQueries({ queryKey: ["dias-tipo-cadastrados"] });
      }} />

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
