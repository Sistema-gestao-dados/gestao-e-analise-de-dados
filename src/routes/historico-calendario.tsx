import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  fetchCalendarioEventos, insertCalendarioEvento, updateCalendarioEvento, deleteCalendarioEvento,
  fetchCategoriaCores, salvarCategoriaCor,
  expandirPorDia, corCategoria, CATEGORIAS_BASE, DIA_TIPO_OPTIONS, DIA_TIPO_TODOS, type CalendarioEvento,
} from "@/lib/calendario";
import {
  buscarFeriadosNacionais, buscarChuvaHistorica, CIDADES, FERIADOS_MUNICIPAIS,
} from "@/lib/calendario-importar";
import { fetchLinhas } from "@/lib/data";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Pencil, Trash2, CalendarDays, Palette, CloudRain, PartyPopper, Loader2 } from "lucide-react";

export const Route = createFileRoute("/historico-calendario")({
  head: () => ({ meta: [{ title: "Calendário de Informações — Gestão e Análise de Dados" }] }),
  component: CalendarioPage,
});

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function dkey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthMatrix(monthDate: Date): Date[][] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks: Date[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

type FormState = {
  id: string | null;
  data_inicio: string;
  data_fim: string;
  diaTipo: string;
  categorias: string[];
  usarNovaCategoria: boolean;
  categoriaNova: string;
  linha: string;
  descricao: string;
};

function emptyForm(data: string): FormState {
  return {
    id: null, data_inicio: data, data_fim: data, diaTipo: DIA_TIPO_TODOS,
    categorias: [CATEGORIAS_BASE[0]], usarNovaCategoria: false, categoriaNova: "",
    linha: "__todas", descricao: "",
  };
}

function CalendarioPage() {
  useAuditView("calendario_informacoes");
  const qc = useQueryClient();
  const eventosQ = useQuery({ queryKey: ["calendario-eventos"], queryFn: fetchCalendarioEventos });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const coresQ = useQuery({ queryKey: ["calendario-categoria-cor"], queryFn: fetchCategoriaCores });
  const eventos = eventosQ.data ?? [];
  const linhas = linhasQ.data ?? [];
  const coresMap = coresQ.data ?? new Map<string, string>();

  const [fLinha, setFLinha] = useState("__all");
  const [mesRef, setMesRef] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [diaSelecionado, setDiaSelecionado] = useState<Date | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CalendarioEvento | null>(null);
  const [showCores, setShowCores] = useState(false);
  const [showFeriados, setShowFeriados] = useState(false);
  const [showChuva, setShowChuva] = useState(false);
  const [feriadoAno, setFeriadoAno] = useState(() => new Date().getFullYear());
  const [feriadoNacionalOn, setFeriadoNacionalOn] = useState(true);
  const [feriadosMunicipaisOn, setFeriadosMunicipaisOn] = useState<Set<number>>(new Set(FERIADOS_MUNICIPAIS.map((_, i) => i)));
  const [importandoFeriados, setImportandoFeriados] = useState(false);
  const [chuvaInicio, setChuvaInicio] = useState("");
  const [chuvaFim, setChuvaFim] = useState("");
  const [chuvaLimiar, setChuvaLimiar] = useState(20);
  const [chuvaCidades, setChuvaCidades] = useState<Set<string>>(new Set(CIDADES.map((c) => c.nome)));
  const [importandoChuva, setImportandoChuva] = useState(false);

  const eventosVisiveis = useMemo(
    () => (fLinha === "__all" ? eventos : eventos.filter((e) => !e.linha || e.linha === fLinha)),
    [eventos, fLinha],
  );
  const porDia = useMemo(() => expandirPorDia(eventosVisiveis), [eventosVisiveis]);
  const semanas = useMemo(() => monthMatrix(mesRef), [mesRef]);

  const categoriasPresentes = useMemo(() => {
    const set = new Set<string>(CATEGORIAS_BASE);
    for (const e of eventos) set.add(e.categoria);
    return Array.from(set);
  }, [eventos]);

  const eventosDoMes = useMemo(() => {
    const primeiroDia = dkey(new Date(mesRef.getFullYear(), mesRef.getMonth(), 1));
    const ultimoDia = dkey(new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 0));
    // sobreposição de intervalos: [data_inicio,data_fim] cruza [primeiroDia,ultimoDia] do mês exibido
    return eventosVisiveis
      .filter((e) => e.data_inicio <= ultimoDia && e.data_fim >= primeiroDia)
      .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));
  }, [eventosVisiveis, mesRef]);

  function abrirNovo(data: Date) {
    setForm(emptyForm(dkey(data)));
  }

  function abrirEdicao(ev: CalendarioEvento) {
    const conhecida = CATEGORIAS_BASE.includes(ev.categoria);
    setForm({
      id: ev.id,
      data_inicio: ev.data_inicio,
      data_fim: ev.data_fim,
      diaTipo: ev.dia_tipo ?? DIA_TIPO_TODOS,
      categorias: conhecida ? [ev.categoria] : [],
      usarNovaCategoria: !conhecida,
      categoriaNova: conhecida ? "" : ev.categoria,
      linha: ev.linha ?? "__todas",
      descricao: ev.descricao ?? "",
    });
  }

  function toggleCategoria(cat: string) {
    setForm((f) => f && {
      ...f,
      categorias: f.categorias.includes(cat) ? f.categorias.filter((c) => c !== cat) : [...f.categorias, cat],
    });
  }

  async function salvar() {
    if (!form) return;
    const categoriasFinais = Array.from(new Set([
      ...form.categorias,
      ...(form.usarNovaCategoria && form.categoriaNova.trim() ? [form.categoriaNova.trim()] : []),
    ]));
    if (!categoriasFinais.length) { toast.error("Selecione ao menos uma categoria"); return; }
    if (!form.data_inicio || !form.data_fim) { toast.error("Informe o período"); return; }
    if (form.data_fim < form.data_inicio) { toast.error("Data fim não pode ser antes da data início"); return; }
    setSaving(true);
    try {
      const base = {
        data_inicio: form.data_inicio,
        data_fim: form.data_fim,
        dia_tipo: form.diaTipo === DIA_TIPO_TODOS ? null : form.diaTipo,
        linha: form.linha === "__todas" ? null : form.linha,
        descricao: form.descricao.trim() || null,
      };
      if (form.id) {
        // Editando um evento (1 linha = 1 categoria): a linha existente vira a
        // 1ª categoria marcada; categorias extras marcadas viram novas linhas.
        await updateCalendarioEvento(form.id, { ...base, categoria: categoriasFinais[0] });
        void logAudit({ action: "update", entity: "calendario_eventos", entity_id: form.id, details: { ...base, categoria: categoriasFinais[0] } });
        for (const cat of categoriasFinais.slice(1)) {
          const created = await insertCalendarioEvento({ ...base, categoria: cat });
          void logAudit({ action: "create", entity: "calendario_eventos", entity_id: created.id, details: { ...base, categoria: cat } });
        }
        toast.success(categoriasFinais.length > 1 ? "Evento atualizado e categorias extras adicionadas" : "Evento atualizado");
      } else {
        for (const cat of categoriasFinais) {
          const created = await insertCalendarioEvento({ ...base, categoria: cat });
          void logAudit({ action: "create", entity: "calendario_eventos", entity_id: created.id, details: { ...base, categoria: cat } });
        }
        toast.success(categoriasFinais.length > 1 ? `${categoriasFinais.length} eventos registrados` : "Evento registrado");
      }
      qc.invalidateQueries({ queryKey: ["calendario-eventos"] });
      setForm(null);
    } catch (e: any) {
      toast.error("Erro ao salvar", { description: e?.message ?? "erro" });
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    if (!confirmDelete) return;
    try {
      await deleteCalendarioEvento(confirmDelete.id);
      void logAudit({ action: "delete", entity: "calendario_eventos", entity_id: confirmDelete.id });
      toast.success("Evento excluído");
      qc.invalidateQueries({ queryKey: ["calendario-eventos"] });
    } catch (e: any) {
      toast.error("Erro ao excluir", { description: e?.message ?? "erro" });
    } finally {
      setConfirmDelete(null);
    }
  }

  async function salvarCor(categoria: string, cor: string) {
    try {
      await salvarCategoriaCor(categoria, cor);
      qc.invalidateQueries({ queryKey: ["calendario-categoria-cor"] });
    } catch (e: any) {
      toast.error("Erro ao salvar cor", { description: e?.message ?? "erro" });
    }
  }

  // Feriados nacionais vêm da BrasilAPI (fonte pública, atualizada). Os 3
  // municipais foram pesquisados manualmente (ver src/lib/calendario-importar.ts)
  // e o usuário confirma/desmarca cada um antes de importar — não é um feed
  // automático confiável como o nacional.
  async function importarFeriados() {
    setImportandoFeriados(true);
    let inseridos = 0, ignorados = 0;
    try {
      if (feriadoNacionalOn) {
        const lista = await buscarFeriadosNacionais(feriadoAno);
        for (const f of lista) {
          const jaExiste = eventos.some((e) => e.categoria.toLowerCase() === "feriado nacional" && e.data_inicio === f.data && e.data_fim === f.data);
          if (jaExiste) { ignorados += 1; continue; }
          await insertCalendarioEvento({ data_inicio: f.data, data_fim: f.data, dia_tipo: null, categoria: "Feriado Nacional", linha: null, descricao: f.nome });
          inseridos += 1;
        }
      }
      for (let i = 0; i < FERIADOS_MUNICIPAIS.length; i++) {
        if (!feriadosMunicipaisOn.has(i)) continue;
        const fm = FERIADOS_MUNICIPAIS[i];
        const data = `${feriadoAno}-${String(fm.mes).padStart(2, "0")}-${String(fm.dia).padStart(2, "0")}`;
        const descricao = `${fm.cidade} — ${fm.nome} (${fm.fonte})`;
        const jaExiste = eventos.some((e) => e.categoria.toLowerCase() === "feriado municipal" && e.data_inicio === data && (e.descricao ?? "").includes(fm.cidade));
        if (jaExiste) { ignorados += 1; continue; }
        await insertCalendarioEvento({ data_inicio: data, data_fim: data, dia_tipo: null, categoria: "Feriado Municipal", linha: null, descricao });
        inseridos += 1;
      }
      void logAudit({ action: "import", entity: "calendario_eventos", details: { tipo: "feriados", ano: feriadoAno, inseridos, ignorados } });
      qc.invalidateQueries({ queryKey: ["calendario-eventos"] });
      toast.success(`${inseridos} feriado(s) importado(s)${ignorados ? `, ${ignorados} já existiam` : ""}`);
      setShowFeriados(false);
    } catch (e: any) {
      toast.error("Erro ao importar feriados", { description: e?.message ?? "erro" });
    } finally {
      setImportandoFeriados(false);
    }
  }

  // Chuva histórica: Open-Meteo (reanálise ERA5), sem chave, cobre qualquer
  // data passada. Marca "Tempo chuvoso" nos dias com precipitação >= limiar.
  // Um dia com chuva em mais de uma cidade vira 1 evento só (não 1 por
  // cidade), listando todas as cidades na descrição — evita ficar
  // triplicado no calendário quando chove em Rio+Niterói+São Gonçalo junto.
  async function importarChuva() {
    if (!chuvaInicio || !chuvaFim) { toast.error("Informe o período"); return; }
    if (chuvaFim < chuvaInicio) { toast.error("Data fim não pode ser antes da data início"); return; }
    setImportandoChuva(true);
    let inseridos = 0, ignorados = 0;
    try {
      const porDia = new Map<string, { cidade: string; mm: number }[]>();
      for (const cidade of CIDADES) {
        if (!chuvaCidades.has(cidade.nome)) continue;
        const dias = await buscarChuvaHistorica(cidade, chuvaInicio, chuvaFim);
        for (const d of dias) {
          if (d.mm < chuvaLimiar) continue;
          const arr = porDia.get(d.data) ?? [];
          arr.push({ cidade: cidade.nome, mm: d.mm });
          porDia.set(d.data, arr);
        }
      }
      for (const [data, cidadesDoDia] of porDia) {
        const jaExiste = eventos.some((e) => e.categoria.toLowerCase() === "tempo chuvoso" && e.data_inicio === data && e.data_fim === data);
        if (jaExiste) { ignorados += 1; continue; }
        const descricao = `${cidadesDoDia.map((c) => `${c.cidade} (${c.mm.toFixed(1)}mm)`).join(", ")} — fonte: Open-Meteo/ERA5`;
        await insertCalendarioEvento({ data_inicio: data, data_fim: data, dia_tipo: null, categoria: "Tempo chuvoso", linha: null, descricao });
        inseridos += 1;
      }
      void logAudit({ action: "import", entity: "calendario_eventos", details: { tipo: "chuva", periodo: [chuvaInicio, chuvaFim], limiar: chuvaLimiar, inseridos, ignorados } });
      qc.invalidateQueries({ queryKey: ["calendario-eventos"] });
      toast.success(`${inseridos} dia(s) de chuva forte importado(s)${ignorados ? `, ${ignorados} já existiam` : ""}`);
      setShowChuva(false);
    } catch (e: any) {
      toast.error("Erro ao importar chuva histórica", { description: e?.message ?? "erro" });
    } finally {
      setImportandoChuva(false);
    }
  }

  const hojeKey = dkey(new Date());
  const eventosDoDiaSelecionado = diaSelecionado ? (porDia.get(dkey(diaSelecionado)) ?? []) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2"><Link to="/historico-consultar"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Calendário de Informações</h1>
          <p className="text-sm text-muted-foreground">
            Registre chuva, obras na via, redução operacional etc. por dia ou período — pra visualizar
            rápido e não usar os dados daquele dia como referência pra reprogramação de linha.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowChuva(true)}><CloudRain className="h-4 w-4 mr-1" /> Importar chuva</Button>
          <Button variant="outline" size="sm" onClick={() => setShowFeriados(true)}><PartyPopper className="h-4 w-4 mr-1" /> Importar feriados</Button>
          <Button variant="outline" size="sm" onClick={() => setShowCores(true)}><Palette className="h-4 w-4 mr-1" /> Cores</Button>
          <Button size="sm" onClick={() => abrirNovo(new Date())}><Plus className="h-4 w-4 mr-1" /> Novo evento</Button>
        </div>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Linha</label>
            <Select value={fLinha} onValueChange={setFLinha}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todas</SelectItem>
                {linhas.map((l) => <SelectItem key={l.linha} value={l.linha}>{l.linha}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {categoriasPresentes.map((c) => (
              <span key={c} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: corCategoria(c, coresMap) }} /> {c}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" /> {MESES[mesRef.getMonth()]} {mesRef.getFullYear()}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMesRef((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { const d = new Date(); d.setDate(1); setMesRef(d); }}>Hoje</Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMesRef((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            {DIAS_SEMANA.map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {semanas.flat().map((d) => {
              const k = dkey(d);
              const evs = porDia.get(k) ?? [];
              const foraDoMes = d.getMonth() !== mesRef.getMonth();
              const categoriasUnicas = Array.from(new Set(evs.map((e) => e.categoria)));
              return (
                <button
                  key={k}
                  onClick={() => setDiaSelecionado(d)}
                  className={`min-h-[64px] rounded-md border p-1.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 ${
                    foraDoMes ? "border-transparent text-muted-foreground/40" : "border-border"
                  } ${k === hojeKey ? "ring-1 ring-primary" : ""}`}
                >
                  <span className={`text-xs tabular-nums ${k === hojeKey ? "font-bold text-primary" : ""}`}>{d.getDate()}</span>
                  {evs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {categoriasUnicas.slice(0, 4).map((c) => (
                        <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: corCategoria(c, coresMap) }} />
                      ))}
                      {evs.length > 4 && <span className="text-[9px] text-muted-foreground">+{evs.length - 4}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Eventos em {MESES[mesRef.getMonth()]} ({eventosDoMes.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {eventosDoMes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum evento registrado neste mês.</p>
          ) : (
            <div className="divide-y divide-border">
              {eventosDoMes.map((e) => (
                <div key={e.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: corCategoria(e.categoria, coresMap) }} />
                  <span className="text-muted-foreground whitespace-nowrap tabular-nums">
                    {fmtCurto(e.data_inicio)}{e.data_fim !== e.data_inicio ? ` – ${fmtCurto(e.data_fim)}` : ""}
                  </span>
                  <Badge variant="outline">{e.categoria}</Badge>
                  {e.dia_tipo && <Badge variant="outline" className="text-[10px]">{e.dia_tipo}</Badge>}
                  {e.linha && <Badge variant="secondary">Linha {e.linha}</Badge>}
                  <span className="text-muted-foreground truncate flex-1">{e.descricao || "—"}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => abrirEdicao(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setConfirmDelete(e)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!diaSelecionado} onOpenChange={(o) => !o && setDiaSelecionado(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{diaSelecionado && fmtLongo(diaSelecionado)}</DialogTitle>
            <DialogDescription>{eventosDoDiaSelecionado.length} evento(s) neste dia.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {eventosDoDiaSelecionado.length === 0 && <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>}
            {eventosDoDiaSelecionado.map((e) => (
              <div key={e.id} className="flex items-start gap-2 border rounded-md p-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: corCategoria(e.categoria, coresMap) }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{e.categoria}</span>
                    {e.dia_tipo && <Badge variant="outline" className="text-[10px]">{e.dia_tipo}</Badge>}
                    {e.linha && <Badge variant="secondary" className="text-[10px]">Linha {e.linha}</Badge>}
                    {e.data_fim !== e.data_inicio && (
                      <span className="text-[11px] text-muted-foreground">{fmtCurto(e.data_inicio)} – {fmtCurto(e.data_fim)}</span>
                    )}
                  </div>
                  {e.descricao && <p className="text-xs text-muted-foreground mt-0.5">{e.descricao}</p>}
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setDiaSelecionado(null); abrirEdicao(e); }}><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setConfirmDelete(e)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { const d = diaSelecionado; setDiaSelecionado(null); if (d) abrirNovo(d); }}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar evento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar evento" : "Novo evento"}</DialogTitle>
            <DialogDescription>Registre o que ocorreu — chuva, obra, redução operacional etc.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label>Data início</Label>
                <Input type="date" value={form.data_inicio} onChange={(e) => setForm((f) => f && { ...f, data_inicio: e.target.value })} />
              </div>
              <div>
                <Label>Data fim</Label>
                <Input type="date" value={form.data_fim} onChange={(e) => setForm((f) => f && { ...f, data_fim: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label>Dia tipo do período</Label>
                <Select value={form.diaTipo} onValueChange={(v) => setForm((f) => f && { ...f, diaTipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DIA_TIPO_TODOS}>Todos os dias do período</SelectItem>
                    {DIA_TIPO_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Ex.: período 01 a 30/09 + "Dias úteis" marca só segunda a sexta, ignorando sábados e domingos.
                </p>
              </div>
              <div className="md:col-span-2">
                <Label>Categoria(s)</Label>
                <div className="mt-1 space-y-1.5 border rounded-md p-2.5">
                  {categoriasPresentes.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <Checkbox checked={form.categorias.includes(c)} onCheckedChange={() => toggleCategoria(c)} />
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: corCategoria(c, coresMap) }} /> {c}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <Checkbox checked={form.usarNovaCategoria} onCheckedChange={(v) => setForm((f) => f && { ...f, usarNovaCategoria: !!v })} />
                    + Outra categoria...
                  </label>
                  {form.usarNovaCategoria && (
                    <Input placeholder="Nome da categoria" value={form.categoriaNova} onChange={(e) => setForm((f) => f && { ...f, categoriaNova: e.target.value })} />
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
                <Label>Linha afetada</Label>
                <Select value={form.linha} onValueChange={(v) => setForm((f) => f && { ...f, linha: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__todas">Todas as linhas (ex.: chuva na cidade)</SelectItem>
                    {linhas.map((l) => <SelectItem key={l.linha} value={l.linha}>{l.linha}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Descrição</Label>
                <Textarea rows={3} value={form.descricao} onChange={(e) => setForm((f) => f && { ...f, descricao: e.target.value })} placeholder="Detalhes do que ocorreu..." />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir evento?</DialogTitle>
            <DialogDescription>Essa ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={excluir}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCores} onOpenChange={setShowCores}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cores das categorias</DialogTitle>
            <DialogDescription>Escolha a cor de cada categoria — vale pra todo mundo que usa o sistema.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {categoriasPresentes.map((c) => (
              <div key={c} className="flex items-center justify-between gap-3 border rounded-md p-2">
                <span className="text-sm">{c}</span>
                <input
                  type="color"
                  value={corCategoria(c, coresMap)}
                  onChange={(e) => salvarCor(c, e.target.value)}
                  className="h-8 w-12 rounded border border-border cursor-pointer bg-transparent"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCores(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFeriados} onOpenChange={(o) => !importandoFeriados && setShowFeriados(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar feriados</DialogTitle>
            <DialogDescription>
              Nacionais vêm de fonte pública (BrasilAPI), atualizada automaticamente. Os municipais
              abaixo foram pesquisados manualmente — confira a lei/fonte antes de confiar 100%.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Ano</Label>
              <Input type="number" value={feriadoAno} onChange={(e) => setFeriadoAno(Number(e.target.value) || feriadoAno)} className="w-32" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <Checkbox checked={feriadoNacionalOn} onCheckedChange={(v) => setFeriadoNacionalOn(!!v)} />
              Feriados nacionais (BrasilAPI)
            </label>
            <div className="space-y-1.5 border rounded-md p-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-1">Feriados municipais (data fixa, ano {feriadoAno})</p>
              {FERIADOS_MUNICIPAIS.map((fm, i) => (
                <label key={fm.cidade} className="flex items-start gap-2 text-sm cursor-pointer select-none">
                  <Checkbox
                    checked={feriadosMunicipaisOn.has(i)}
                    onCheckedChange={(v) => setFeriadosMunicipaisOn((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(i); else next.delete(i);
                      return next;
                    })}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>{fm.cidade}</strong> — {String(fm.dia).padStart(2, "0")}/{String(fm.mes).padStart(2, "0")}: {fm.nome}
                    <br /><span className="text-[11px] text-muted-foreground">{fm.fonte}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFeriados(false)} disabled={importandoFeriados}>Cancelar</Button>
            <Button onClick={importarFeriados} disabled={importandoFeriados}>
              {importandoFeriados ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importando...</> : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showChuva} onOpenChange={(o) => !importandoChuva && setShowChuva(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar chuva histórica</DialogTitle>
            <DialogDescription>
              Precipitação diária via Open-Meteo (reanálise ERA5, sem cadastro) — cobre praticamente
              qualquer data passada. Dias com chuva acima do limiar viram evento "Tempo chuvoso".
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data início</Label>
              <Input type="date" value={chuvaInicio} onChange={(e) => setChuvaInicio(e.target.value)} />
            </div>
            <div>
              <Label>Data fim</Label>
              <Input type="date" value={chuvaFim} onChange={(e) => setChuvaFim(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label>Limiar de chuva forte (mm no dia)</Label>
              <Input type="number" min={1} value={chuvaLimiar} onChange={(e) => setChuvaLimiar(Number(e.target.value) || 1)} className="w-32" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Cidades</Label>
              {CIDADES.map((cidade) => (
                <label key={cidade.nome} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox
                    checked={chuvaCidades.has(cidade.nome)}
                    onCheckedChange={(v) => setChuvaCidades((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(cidade.nome); else next.delete(cidade.nome);
                      return next;
                    })}
                  />
                  {cidade.nome}
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChuva(false)} disabled={importandoChuva}>Cancelar</Button>
            <Button onClick={importarChuva} disabled={importandoChuva}>
              {importandoChuva ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Buscando...</> : "Buscar e importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function fmtCurto(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

function fmtLongo(d: Date): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
