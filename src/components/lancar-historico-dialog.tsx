// Janela "Lançar no Histórico" do Relatório Comparativo: gera um registro
// do Histórico de Reprogramação por linha (ou por Grupo de Linha) da
// Proposta, com a Alteração já escrita a partir da diferença Atual ×
// Proposta. Tudo é editável antes de gravar — linhas marcadas, linha, dia
// tipo, nº da versão e texto. Texto e regras em src/lib/historico-lancamento.ts.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchHistorico, ensureDiaTipo, numeroVersao, diaTipoBase, type HistoricoInput } from "@/lib/historico";
import {
  montarRegistros, textoFinal, OPCOES_PADRAO, type LinhaLancamento, type OpcoesTexto,
} from "@/lib/historico-lancamento";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/lib/auth-context";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Loader2, RotateCcw } from "lucide-react";

type Edicao = Partial<{ selecionado: boolean; linha: string; diaTipo: string; versao: string; texto: string }>;

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export function LancarHistoricoDialog({ linhas, motivoDesabilitado }: {
  linhas: LinhaLancamento[];
  /** Preenchido = botão desabilitado, com esse motivo no título. */
  motivoDesabilitado?: string | null;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [opcoesSalvas, setOpcoes] = usePersistentState<OpcoesTexto>("lancarHistorico.opcoes", OPCOES_PADRAO);
  // Junta com o padrão: escolha salva no navegador por versão antiga desta
  // janela pode não ter todos os campos.
  const opcoes = useMemo(() => ({ ...OPCOES_PADRAO, ...opcoesSalvas }), [opcoesSalvas]);
  const [modo, setModo] = usePersistentState<"linha" | "grupo">("lancarHistorico.modo", "linha");
  const [vigencia, setVigencia] = useState("");
  const [dataSolicitacao, setDataSolicitacao] = useState("");
  const [referencia, setReferencia] = useState("");
  const [descricao, setDescricao] = useState("");
  const [edicoes, setEdicoes] = useState<Map<string, Edicao>>(new Map());

  const historicoQ = useQuery({ queryKey: ["historico-reprogramacao"], queryFn: fetchHistorico, enabled: aberto });

  const registros = useMemo(() => montarRegistros(linhas, opcoes, modo), [linhas, opcoes, modo]);

  // Já existe no Histórico: mesma linha + nº da versão + dia tipo (pelo dia
  // base, igual à Conferência — o Histórico tem vocabulário próprio).
  const jaExiste = (linha: string, versao: number | null, dia: string) => {
    if (versao == null) return false;
    const base = diaTipoBase(dia);
    return (historicoQ.data ?? []).some((h) =>
      norm(h.linha) === norm(linha) && h.versao === versao
      && (base && diaTipoBase(h.dia_tipo) ? diaTipoBase(h.dia_tipo) === base : norm(h.dia_tipo) === norm(dia)));
  };

  const linhasTela = registros.map((r) => {
    const e = edicoes.get(r.chave) ?? {};
    const versaoGerada = numeroVersao(r.versaoTexto);
    const linha = e.linha ?? r.linha;
    const diaTipo = e.diaTipo ?? r.diaTipo;
    const versao = e.versao ?? (versaoGerada == null ? "" : String(versaoGerada));
    const nVersao = /^\d+$/.test(versao.trim()) ? Number(versao.trim()) : null;
    const existe = jaExiste(linha, nVersao, diaTipo);
    // Marcada por padrão: está na Proposta (não repetida da Atual), tem nº
    // de versão e ainda não está no Histórico.
    const padraoSel = r.linhas.some((l) => l.p && !l.repetida) && nVersao != null && !existe;
    return {
      r, linha, diaTipo, versao, nVersao, existe,
      selecionado: e.selecionado ?? padraoSel,
      texto: e.texto ?? r.texto,
      textoEditado: e.texto != null,
    };
  });
  const selecionadas = linhasTela.filter((x) => x.selecionado);

  function editar(chave: string, e: Edicao) {
    setEdicoes((prev) => {
      const m = new Map(prev);
      m.set(chave, { ...(m.get(chave) ?? {}), ...e });
      return m;
    });
  }
  function restaurarTexto(chave: string) {
    setEdicoes((prev) => {
      const m = new Map(prev);
      const { texto: _t, ...resto } = m.get(chave) ?? {};
      m.set(chave, resto);
      return m;
    });
  }
  function marcarTodas(v: boolean) {
    setEdicoes((prev) => {
      const m = new Map(prev);
      for (const x of linhasTela) m.set(x.r.chave, { ...(m.get(x.r.chave) ?? {}), selecionado: v });
      return m;
    });
  }

  async function salvar() {
    if (!vigencia) { toast.error("Informe a Vigência."); return; }
    if (!selecionadas.length) { toast.error("Marque pelo menos uma linha."); return; }
    const semVersao = selecionadas.filter((x) => x.nVersao == null || !x.linha.trim());
    if (semVersao.length) {
      toast.error(`Linha e nº da versão são obrigatórios — confira: ${semVersao.map((x) => x.linha || "(sem linha)").join(", ")}`);
      return;
    }
    setSalvando(true);
    try {
      const payload: HistoricoInput[] = selecionadas.map((x) => ({
        linha: x.linha.trim(),
        versao: x.nVersao,
        dia_tipo: x.diaTipo.trim() || null,
        referencia: referencia.trim() || null,
        data_solicitacao: dataSolicitacao || null,
        vigencia,
        encerramento: null,
        alteracao: textoFinal(descricao, x.texto),
        ativo: true,
      }));
      const { error } = await supabase.from("historico_reprogramacao").insert(payload);
      if (error) throw error;
      for (const d of new Set(payload.map((p) => p.dia_tipo).filter(Boolean) as string[])) await ensureDiaTipo(d);
      void logAudit({ action: "create", entity: "historico_reprogramacao", details: { origem: "comparativo", registros: payload.length, vigencia, referencia } });
      qc.invalidateQueries({ queryKey: ["historico-reprogramacao"] });
      qc.invalidateQueries({ queryKey: ["historico-dia-tipos"] });
      toast.success(`${payload.length} registro(s) lançado(s) no Histórico.`);
      setEdicoes(new Map());
      setAberto(false);
    } catch (e) {
      toast.error("Erro ao lançar no Histórico", { description: (e as Error).message });
    } finally {
      setSalvando(false);
    }
  }

  if (!can("historico_reprogramacao")) return null;

  const opcaoCheck = (k: "partidas" | "km" | "he" | "custo" | "programado", label: string) => (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
      <Checkbox checked={opcoes[k]} onCheckedChange={(v) => setOpcoes({ ...opcoes, [k]: !!v })} className="h-3.5 w-3.5" />
      {label}
    </label>
  );

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => { setEdicoes(new Map()); setAberto(true); }}
        disabled={!!motivoDesabilitado || !linhas.length}
        title={motivoDesabilitado ?? "Gera os registros do Histórico de Reprogramação a partir deste comparativo"}
      >
        <History className="h-4 w-4 mr-1" /> Lançar no Histórico
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lançar no Histórico de Reprogramação</DialogTitle>
            <DialogDescription>
              Um registro por linha marcada, com a Alteração calculada da Atual pra Proposta. Confira e edite o que precisar antes de lançar.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Vigência *</label>
              <Input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Data de solicitação</label>
              <Input type="date" value={dataSolicitacao} onChange={(e) => setDataSolicitacao(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Referência</label>
              <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex.: Julho" className="h-8 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Um registro por</label>
              <Select value={modo} onValueChange={(v) => { setModo(v as "linha" | "grupo"); setEdicoes(new Map()); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="linha">Linha</SelectItem>
                  <SelectItem value="grupo">Grupo de Linha (ex.: 01 + 01A juntas)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 md:col-span-4">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Descrição geral (vai no início de todas)</label>
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Programação de férias julho de 2026." className="h-8 text-xs" />
            </div>
          </div>

          <div className="rounded-md border p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Na alteração:</span>
            {([["carros", "Carros"], ["servicos", "Serviços / motoristas"]] as const).map(([k, label]) => (
              <div key={k} className="flex items-center gap-1.5 text-xs">
                {label}
                <Select value={opcoes[k]} onValueChange={(v) => setOpcoes({ ...opcoes, [k]: v as OpcoesTexto[typeof k] })}>
                  <SelectTrigger className="h-7 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="total">Total</SelectItem>
                    <SelectItem value="turno">Por turno (1º T., 2º T., Aproveit., TU)</SelectItem>
                    <SelectItem value="nao">Não incluir</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
            {opcaoCheck("partidas", "Partidas")}
            {opcaoCheck("km", "KM")}
            {opcaoCheck("he", "Hora extra")}
            {opcaoCheck("custo", "Custo M.O.")}
            {opcaoCheck("programado", "Mostrar \"Programado\"")}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {selecionadas.length} de {linhasTela.length} marcada(s){historicoQ.isLoading && " · conferindo o que já existe no Histórico..."}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => marcarTodas(true)}>Marcar todas</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => marcarTodas(false)}>Desmarcar todas</Button>
            </div>
          </div>

          <div className="space-y-2">
            {linhasTela.map((x) => (
              <div key={x.r.chave} className={`rounded-md border p-2 grid gap-2 md:grid-cols-[auto_90px_150px_80px_1fr] items-start ${x.selecionado ? "" : "opacity-60"}`}>
                <Checkbox checked={x.selecionado} onCheckedChange={(v) => editar(x.r.chave, { selecionado: !!v })} className="mt-2" />
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">Linha</span>
                  <Input value={x.linha} onChange={(e) => editar(x.r.chave, { linha: e.target.value })} className="h-7 text-xs" />
                  {x.r.linhas.length > 1 && <span className="text-[10px] text-muted-foreground">{x.r.linhas.map((l) => l.linha).join(" + ")}</span>}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">Dia tipo</span>
                  <Input value={x.diaTipo} onChange={(e) => editar(x.r.chave, { diaTipo: e.target.value })} className="h-7 text-xs" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground" title={x.r.versaoTexto}>Nº versão</span>
                  <Input value={x.versao} onChange={(e) => editar(x.r.chave, { versao: e.target.value })} className="h-7 text-xs" inputMode="numeric" />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>Alteração</span>
                    {x.r.versaoTexto && <span className="truncate">· {x.r.versaoTexto}</span>}
                    {x.existe && <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">já existe no Histórico</Badge>}
                    {x.r.linhas.every((l) => l.repetida) && <Badge variant="outline" className="text-[10px]">repetida da Atual</Badge>}
                    {x.textoEditado && (
                      <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px] ml-auto" onClick={() => restaurarTexto(x.r.chave)} title="Volta pro texto gerado">
                        <RotateCcw className="h-3 w-3 mr-1" /> Restaurar texto
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={x.texto}
                    onChange={(e) => editar(x.r.chave, { texto: e.target.value })}
                    rows={Math.min(8, Math.max(2, x.texto.split("\n").length + 1))}
                    className="text-xs"
                  />
                </div>
              </div>
            ))}
          </div>

          {descricao.trim() && selecionadas[0] && (
            <div className="rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Como fica gravado (1ª marcada)</div>
              {textoFinal(descricao, selecionadas[0].texto)}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={salvando}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando || !selecionadas.length}>
              {salvando ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Lançando...</> : `Lançar ${selecionadas.length} registro(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
