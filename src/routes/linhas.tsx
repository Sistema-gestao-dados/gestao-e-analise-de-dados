import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchLinhas, fetchKm, fetchMulti, type Linha } from "@/lib/data";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Bus, MapPin, Layers, Building2, Hash, Tag, Save, X, Trash2, Pencil, Clock, FileDown, FileUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { exportTemplate, importTemplate } from "@/lib/linhas-template";
import { useAuditView } from "@/lib/use-audit-view";

export const Route = createFileRoute("/linhas")({
  head: () => ({
    meta: [
      { title: "Cadastro de Linhas — Gestão e Análise de Dados" },
      { name: "description", content: "Ficha completa editável de cada linha com dados consolidados das três planilhas." },
    ],
  }),
  component: LinhasPage,
});

type FormState = {
  linha: string;
  empresa: string;
  unidade: string;
  ordem: string;
  categoria: string;
  antec_t1: string; prest_t1: string;
  antec_t2: string; prest_t2: string;
  antec_t3: string; prest_t3: string;
};

function toForm(l: Linha): FormState {
  return {
    linha: l.linha ?? "",
    empresa: l.empresa ?? "",
    unidade: l.unidade ?? "",
    ordem: l.ordem != null ? String(l.ordem) : "",
    categoria: l.categoria ?? "",
    antec_t1: String(l.antec_t1 ?? 0), prest_t1: String(l.prest_t1 ?? 0),
    antec_t2: String(l.antec_t2 ?? 0), prest_t2: String(l.prest_t2 ?? 0),
    antec_t3: String(l.antec_t3 ?? 0), prest_t3: String(l.prest_t3 ?? 0),
  };
}

function LinhasPage() {
  useAuditView("linhas");
  const qc = useQueryClient();
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const kmQ = useQuery({ queryKey: ["km"], queryFn: fetchKm });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });

  const [q, setQ] = useState("");
  const [empresa, setEmpresa] = useState<string>("__all");
  const [categoria, setCategoria] = useState<string>("__all");
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const linhas = linhasQ.data ?? [];
  const km = kmQ.data ?? [];
  const multi = multiQ.data ?? [];

  const empresas = useMemo(() => Array.from(new Set(linhas.map((l) => l.empresa).filter(Boolean))).sort() as string[], [linhas]);
  const categorias = useMemo(() => Array.from(new Set(linhas.map((l) => l.categoria).filter(Boolean))).sort() as string[], [linhas]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return linhas.filter((l) => {
      if (empresa !== "__all" && l.empresa !== empresa) return false;
      if (categoria !== "__all" && l.categoria !== categoria) return false;
      if (!ql) return true;
      return (
        l.linha.toLowerCase().includes(ql) ||
        (l.empresa ?? "").toLowerCase().includes(ql) ||
        (l.unidade ?? "").toLowerCase().includes(ql) ||
        (l.categoria ?? "").toLowerCase().includes(ql)
      );
    });
  }, [linhas, q, empresa, categoria]);

  const current = selected ?? filtered[0]?.linha ?? null;
  const linha = current ? linhas.find((l) => l.linha === current) : null;
  const trechos = current ? km.filter((k) => k.linha === current) : [];
  const grupos = current ? multi.filter((m) => m.linha === current) : [];

  // sync form whenever selected linha changes
  useEffect(() => {
    setForm(linha ? toForm(linha) : null);
    setLastUpdate((linha as any)?.updated_at ?? null);
    if (linha && typeof window !== "undefined") {
      setTimeout(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }
  }, [current]); // eslint-disable-line

  const dirty = useMemo(() => {
    if (!linha || !form) return false;
    const a = toForm(linha);
    return (Object.keys(a) as (keyof FormState)[]).some((k) => a[k] !== form[k]);
  }, [linha, form]);

  const validate = (): string | null => {
    if (!form) return "Sem dados";
    if (!form.linha.trim()) return "Código da linha é obrigatório";
    return null;
  };

  async function doSave() {
    if (!linha || !form) return;
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    const payload = {
      empresa: form.empresa.trim() || null,
      unidade: form.unidade.trim() || null,
      ordem: form.ordem.trim() || null,
      categoria: form.categoria.trim() || null,
      antec_t1: Number(form.antec_t1) || 0,
      prest_t1: Number(form.prest_t1) || 0,
      antec_t2: Number(form.antec_t2) || 0,
      prest_t2: Number(form.prest_t2) || 0,
      antec_t3: Number(form.antec_t3) || 0,
      prest_t3: Number(form.prest_t3) || 0,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("linhas").update(payload).eq("linha", linha.linha);
    setSaving(false);
    setConfirmSave(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success(`Linha ${linha.linha} atualizada`);
    void logAudit({ action: "update", entity: "linhas", entity_id: linha.linha, details: { before: toForm(linha), after: form } });
    setLastUpdate(payload.updated_at);
    qc.invalidateQueries({ queryKey: ["linhas"] });
  }

  async function doBulkDelete() {
    const ids = Array.from(checked);
    if (!ids.length) return;
    setSaving(true);
    const { error } = await supabase.from("linhas").delete().in("linha", ids);
    // also clean related rows
    await supabase.from("parametro_km").delete().in("linha", ids);
    await supabase.from("parametro_multilinha").delete().in("linha", ids);
    setSaving(false);
    setConfirmDelete(false);
    if (error) { toast.error("Erro ao excluir: " + error.message); return; }
    toast.success(`${ids.length} linha(s) excluída(s)`);
    void logAudit({ action: "delete", entity: "linhas", entity_id: ids.join(","), details: { count: ids.length, linhas: ids } });
    if (current && ids.includes(current)) setSelected(null);
    setChecked(new Set());
    qc.invalidateQueries({ queryKey: ["linhas"] });
    qc.invalidateQueries({ queryKey: ["km"] });
    qc.invalidateQueries({ queryKey: ["multi"] });
  }

  const allPageChecked = filtered.length > 0 && filtered.every((l) => checked.has(l.linha));
  function togglePage() {
    const next = new Set(checked);
    if (allPageChecked) filtered.forEach((l) => next.delete(l.linha));
    else filtered.forEach((l) => next.add(l.linha));
    setChecked(next);
  }
  function toggleOne(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cadastro de Linhas</h1>
          <p className="text-sm text-muted-foreground">Ficha unificada e editável de cada linha.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            id="linhas-import-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try {
                const rep = await importTemplate(f);
                toast.success(`Import: ${rep.inserted} novas, ${rep.updated} atualizadas${rep.errors.length ? `, ${rep.errors.length} erro(s)` : ""}`);
                if (rep.errors.length) rep.errors.slice(0, 3).forEach((er) => toast.error(`Linha ${er.row}: ${er.reason}`));
                void logAudit({ action: "import", entity: "linhas", details: rep });
                qc.invalidateQueries({ queryKey: ["linhas"] });
              } catch (err: any) {
                toast.error("Erro na importação: " + (err?.message ?? "desconhecido"));
              } finally {
                (e.target as HTMLInputElement).value = "";
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={() => exportTemplate(linhas)}>
            <FileDown className="h-4 w-4 mr-1.5" /> Exportar Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => document.getElementById("linhas-import-input")?.click()}>
            <FileUp className="h-4 w-4 mr-1.5" /> Importar Excel
          </Button>
          {checked.size > 0 && (
            <>
              <Badge variant="secondary">{checked.size} selecionada(s)</Badge>
              <Button variant="outline" size="sm" onClick={() => setChecked(new Set())}>Limpar</Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Excluir selecionadas
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* List */}
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="pb-3 space-y-3">
            <Input placeholder="Buscar linha, empresa..." value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={empresa} onValueChange={setEmpresa}>
                <SelectTrigger><SelectValue placeholder="Empresa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todas empresas</SelectItem>
                  {empresas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todas categorias</SelectItem>
                  {categorias.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={allPageChecked} onCheckedChange={togglePage} />
                <span className="text-muted-foreground">Selecionar todas filtradas</span>
              </label>
              <span className="text-muted-foreground">{filtered.length} de {linhas.length}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[60vh]">
              <ul className="divide-y divide-border">
                {filtered.map((l) => {
                  const active = l.linha === current;
                  const isChecked = checked.has(l.linha);
                  return (
                    <li key={l.linha} className={`flex items-center gap-2 px-3 transition-colors ${active ? "bg-accent" : "hover:bg-accent/50"}`}>
                      <Checkbox checked={isChecked} onCheckedChange={() => toggleOne(l.linha)} aria-label={`Selecionar ${l.linha}`} />
                      <button onClick={() => setSelected(l.linha)} className="flex-1 text-left py-3 flex items-center justify-between gap-2 min-w-0">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-foreground">{l.linha}</div>
                          <div className="text-xs text-muted-foreground truncate">{l.empresa ?? "Sem empresa"}</div>
                        </div>
                        {l.categoria && <Badge variant="outline" className="shrink-0 text-[10px]">{l.categoria}</Badge>}
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhuma linha encontrada</li>}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail / Editor */}
        <div ref={editorRef} className="space-y-4 min-w-0 scroll-mt-4">
          {linha && form ? (
            <>
              <Card className="shadow-[var(--shadow-card)] overflow-hidden">
                <div className="h-1.5" style={{ background: "var(--gradient-primary)" }} />
                <CardContent className="p-6 space-y-5">
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 rounded-xl flex items-center justify-center text-primary-foreground font-bold text-lg shrink-0" style={{ background: "var(--gradient-primary)" }}>
                        {linha.linha}
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Pencil className="h-3 w-3" /> Editando linha</div>
                        <div className="text-xl font-semibold text-foreground">{linha.linha}</div>
                        {lastUpdate && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3" /> Última alteração: {new Date(lastUpdate).toLocaleString("pt-BR")}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setForm(toForm(linha))}>
                        <X className="h-4 w-4 mr-1.5" /> Cancelar
                      </Button>
                      <Button size="sm" disabled={!dirty || saving} onClick={() => setConfirmSave(true)}>
                        <Save className="h-4 w-4 mr-1.5" /> {saving ? "Salvando..." : "Salvar"}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <EditField icon={Hash} label="Código da Linha *" value={form.linha} onChange={(v) => setForm({ ...form, linha: v })} disabled />
                    <EditField icon={Building2} label="Empresa" value={form.empresa} onChange={(v) => setForm({ ...form, empresa: v })} />
                    <EditField icon={Layers} label="Unidade" value={form.unidade} onChange={(v) => setForm({ ...form, unidade: v })} />
                    <EditField icon={Tag} label="Categoria" value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })} />
                    <EditField icon={Hash} label="Grupo" value={form.ordem} onChange={(v) => setForm({ ...form, ordem: v })} />
                  </div>

                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="h-4 w-4 text-primary" />
                      <h4 className="text-sm font-semibold">Jornada — antecipação e prestação de contas (minutos)</h4>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(["1","2","3"] as const).map((t) => (
                        <div key={t} className="rounded-md border border-border p-3 space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Turno {t}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <EditField icon={Clock} label="Antec. (min)" type="number"
                              value={(form as any)[`antec_t${t}`]}
                              onChange={(v) => setForm({ ...form, [`antec_t${t}`]: v } as any)} />
                            <EditField icon={Clock} label="Prest. (min)" type="number"
                              value={(form as any)[`prest_t${t}`]}
                              onChange={(v) => setForm({ ...form, [`prest_t${t}`]: v } as any)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {dirty && <p className="text-xs text-warning">Alterações não salvas</p>}
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-3">
                <MiniStat icon={MapPin} label="Trechos" value={trechos.length} />
                <MiniStat icon={Bus} label="KM Total" value={trechos.reduce((a, t) => a + Number(t.km), 0).toFixed(1)} />
                <MiniStat icon={Layers} label="Agrupamentos" value={grupos.length} />
              </div>

              <Card className="shadow-[var(--shadow-card)]">
                <CardHeader><CardTitle className="text-base">Detalhes Relacionados</CardTitle></CardHeader>
                <CardContent>
                  <Tabs defaultValue="km">
                    <TabsList>
                      <TabsTrigger value="km">Trechos & KM ({trechos.length})</TabsTrigger>
                      <TabsTrigger value="multi">Multilinha ({grupos.length})</TabsTrigger>
                    </TabsList>
                    <TabsContent value="km" className="mt-4">
                      {trechos.length === 0 ? <Empty msg="Nenhum trecho cadastrado para esta linha." /> : (
                        <div className="rounded-md border border-border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
                              <tr><th className="text-left p-2.5">Origem</th><th className="text-left p-2.5">Destino</th><th className="text-right p-2.5">KM</th><th className="text-left p-2.5">Descrição</th></tr>
                            </thead>
                            <tbody>
                              {trechos.map((t) => (
                                <tr key={t.id} className="border-t border-border hover:bg-muted/50">
                                  <td className="p-2.5 font-medium">{t.origem}</td>
                                  <td className="p-2.5 font-medium">{t.destino}</td>
                                  <td className="p-2.5 text-right tabular-nums">{Number(t.km).toFixed(2)}</td>
                                  <td className="p-2.5 text-muted-foreground">{t.descricao}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="multi" className="mt-4">
                      {grupos.length === 0 ? <Empty msg="Sem agrupamento multilinha." /> : (
                        <div className="rounded-md border border-border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider">
                              <tr><th className="text-left p-2.5">Grupo D.U.</th><th className="text-left p-2.5">Tipo de Dia</th></tr>
                            </thead>
                            <tbody>
                              {grupos.map((m) => (
                                <tr key={m.id} className="border-t border-border hover:bg-muted/50">
                                  <td className="p-2.5">{m.grupo_du}</td>
                                  <td className="p-2.5"><Badge variant="secondary">{m.tipo_dia}</Badge></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">Selecione uma linha à esquerda para ver a ficha completa.</CardContent></Card>
          )}
        </div>
      </div>

      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              Você está alterando a linha <strong>{linha?.linha}</strong>. Esta ação atualizará o cadastro imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doSave}>Salvar alterações</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {checked.size} linha(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá permanentemente <strong>{checked.size}</strong> registro(s) e todos os trechos e agrupamentos relacionados. Não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditField({ icon: Icon, label, value, onChange, type = "text", disabled }: { icon: any; label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground"><Icon className="h-3 w-3" />{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} type={type} disabled={disabled} />
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center"><Icon className="h-4 w-4" /></div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold tabular-nums text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
function Empty({ msg }: { msg: string }) { return <p className="text-sm text-muted-foreground py-6 text-center">{msg}</p>; }
