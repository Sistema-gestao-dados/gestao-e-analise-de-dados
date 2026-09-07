import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchHistorico, updateHistorico, deleteHistorico, buildGrupoParaLinhas, type Historico } from "@/lib/historico";
import { fetchLinhas, fetchMulti } from "@/lib/data";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, X, Check, Trash2, Filter, Search, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/historico-consultar")({
  head: () => ({ meta: [{ title: "Histórico de Reprogramação — Gestão e Análise de Dados" }] }),
  component: ConsultarPage,
});

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

const emptyFiltros = { ano: "__all", mes: "__all", dia_tipo: "__all", linha: "__all", empresa: "__all", grupo: "__all", vigencia: "", ativo: "__all" };

function ConsultarPage() {
  useAuditView("historico_reprogramacao");
  const qc = useQueryClient();

  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const historicoQ = useQuery({ queryKey: ["historico-reprogramacao"], queryFn: fetchHistorico });

  const linhas = linhasQ.data ?? [];
  const multi = multiQ.data ?? [];
  const historico = historicoQ.data ?? [];

  const empresaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l.empresa])), [linhas]);
  const grupoParaLinhas = useMemo(() => buildGrupoParaLinhas(multi), [multi]);

  const [filtros, setFiltros] = useState(emptyFiltros);

  const opts = useMemo(() => ({
    linha: Array.from(new Set(historico.map((h) => h.linha))).sort(),
    diaTipo: Array.from(new Set(historico.map((h) => h.dia_tipo).filter(Boolean) as string[])).sort(),
    empresa: Array.from(new Set(linhas.map((l) => l.empresa).filter(Boolean) as string[])).sort(),
    grupo: Array.from(grupoParaLinhas.keys()).sort(),
    ano: Array.from(new Set(historico.map((h) => h.vigencia?.slice(0, 4)).filter(Boolean) as string[])).sort().reverse(),
  }), [historico, linhas, grupoParaLinhas]);

  const filtered = useMemo(() => {
    return historico.filter((h) => {
      if (filtros.linha !== "__all" && h.linha !== filtros.linha) return false;
      if (filtros.dia_tipo !== "__all" && h.dia_tipo !== filtros.dia_tipo) return false;
      if (filtros.vigencia && h.vigencia !== filtros.vigencia) return false;
      if (filtros.ativo === "S" && !h.ativo) return false;
      if (filtros.ativo === "N" && h.ativo) return false;
      if (filtros.empresa !== "__all" && empresaMap.get(h.linha) !== filtros.empresa) return false;
      if (filtros.grupo !== "__all" && !grupoParaLinhas.get(filtros.grupo)?.has(h.linha)) return false;
      if (filtros.ano !== "__all") {
        if (!h.vigencia || !h.vigencia.startsWith(filtros.ano)) return false;
      }
      if (filtros.mes !== "__all") {
        if (!h.vigencia || h.vigencia.slice(5, 7) !== filtros.mes) return false;
      }
      return true;
    });
  }, [historico, filtros, empresaMap, grupoParaLinhas]);

  const updateMut = useMutation({
    mutationFn: async (row: Partial<Historico> & { id: string }) => {
      const { id, ...rest } = row;
      await updateHistorico(id, rest);
      void logAudit({ action: "update", entity: "historico_reprogramacao", entity_id: id, details: rest });
    },
    onSuccess: () => { toast.success("Atualizado"); qc.invalidateQueries({ queryKey: ["historico-reprogramacao"] }); },
    onError: (e: Error) => toast.error("Erro ao salvar", { description: e.message }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await deleteHistorico(id);
      void logAudit({ action: "delete", entity: "historico_reprogramacao", entity_id: id });
    },
    onSuccess: () => { toast.success("Excluído"); qc.invalidateQueries({ queryKey: ["historico-reprogramacao"] }); },
    onError: (e: Error) => toast.error("Erro ao excluir", { description: e.message }),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Partial<Historico>>({});
  const [detalhe, setDetalhe] = useState<Historico | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function startEdit(h: Historico) { setEditingId(h.id); setEditRow(h); }
  function cancelEdit() { setEditingId(null); setEditRow({}); }
  function saveEdit() {
    if (!editingId) return;
    updateMut.mutate({ ...editRow, id: editingId } as Historico);
    setEditingId(null);
    setEditRow({});
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Histórico de Reprogramação</h1>
          <p className="text-sm text-muted-foreground">Consulte e edite o histórico de mudanças de escala por linha.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild><Link to="/historico-resumo">Resumo</Link></Button>
          <Button size="sm" asChild><Link to="/historico-registrar">Nova reprogramação <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
        </div>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Filtros</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setFiltros(emptyFiltros)}>Limpar</Button>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <FiltroSelect label="Linha" value={filtros.linha} onChange={(v) => setFiltros((f) => ({ ...f, linha: v }))} options={opts.linha} />
          <FiltroSelect label="Empresa" value={filtros.empresa} onChange={(v) => setFiltros((f) => ({ ...f, empresa: v }))} options={opts.empresa} />
          <FiltroSelect label="Grupo de Linha" value={filtros.grupo} onChange={(v) => setFiltros((f) => ({ ...f, grupo: v }))} options={opts.grupo} />
          <FiltroSelect label="Dia Tipo" value={filtros.dia_tipo} onChange={(v) => setFiltros((f) => ({ ...f, dia_tipo: v }))} options={opts.diaTipo} />
          <FiltroSelect label="Ano" value={filtros.ano} onChange={(v) => setFiltros((f) => ({ ...f, ano: v }))} options={opts.ano} />
          <FiltroSelect label="Mês" value={filtros.mes} onChange={(v) => setFiltros((f) => ({ ...f, mes: v }))} options={["01","02","03","04","05","06","07","08","09","10","11","12"]} />
          <FiltroSelect label="Ativo" value={filtros.ativo} onChange={(v) => setFiltros((f) => ({ ...f, ativo: v }))} options={["S", "N"]} />
          <div>
            <label className="text-xs text-muted-foreground">Vigência exata</label>
            <Input type="date" value={filtros.vigencia} onChange={(e) => setFiltros((f) => ({ ...f, vigencia: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-0">
          {historicoQ.isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhum registro encontrado.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Linha</TableHead>
                    <TableHead>Versão</TableHead>
                    <TableHead>Dia Tipo</TableHead>
                    <TableHead>Vigência</TableHead>
                    <TableHead>Encerramento</TableHead>
                    <TableHead>Ativo</TableHead>
                    <TableHead>Alteração</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((h) => {
                    const isEditing = editingId === h.id;
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium">{h.linha}</TableCell>
                        <TableCell>
                          {isEditing ? <Input className="w-20" type="number" value={editRow.versao ?? ""} onChange={(e) => setEditRow((r) => ({ ...r, versao: e.target.value ? Number(e.target.value) : null }))} /> : (h.versao ?? "—")}
                        </TableCell>
                        <TableCell>
                          {isEditing ? <Input className="w-32" value={editRow.dia_tipo ?? ""} onChange={(e) => setEditRow((r) => ({ ...r, dia_tipo: e.target.value }))} /> : (h.dia_tipo ?? "—")}
                        </TableCell>
                        <TableCell>
                          {isEditing ? <Input className="w-36" type="date" value={editRow.vigencia ?? ""} onChange={(e) => setEditRow((r) => ({ ...r, vigencia: e.target.value }))} /> : fmtDate(h.vigencia)}
                        </TableCell>
                        <TableCell>
                          {isEditing ? <Input className="w-36" type="date" value={editRow.encerramento ?? ""} onChange={(e) => setEditRow((r) => ({ ...r, encerramento: e.target.value }))} /> : fmtDate(h.encerramento)}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Select value={editRow.ativo ? "S" : "N"} onValueChange={(v) => setEditRow((r) => ({ ...r, ativo: v === "S" }))}>
                              <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="S">Sim</SelectItem><SelectItem value="N">Não</SelectItem></SelectContent>
                            </Select>
                          ) : (h.ativo ? "Sim" : "Não")}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          {isEditing ? (
                            <Input value={editRow.alteracao ?? ""} onChange={(e) => setEditRow((r) => ({ ...r, alteracao: e.target.value }))} />
                          ) : (
                            <button className="text-left truncate max-w-xs hover:underline" onClick={() => setDetalhe(h)}>{h.alteracao || "—"}</button>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {isEditing ? (
                            <>
                              <Button size="icon" variant="ghost" onClick={saveEdit}><Check className="h-4 w-4 text-success" /></Button>
                              <Button size="icon" variant="ghost" onClick={cancelEdit}><X className="h-4 w-4" /></Button>
                            </>
                          ) : (
                            <>
                              <Button size="icon" variant="ghost" onClick={() => startEdit(h)}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(h.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detalhe} onOpenChange={(o) => !o && setDetalhe(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Linha {detalhe?.linha} — versão {detalhe?.versao ?? "—"}</DialogTitle>
            <DialogDescription>Vigência {fmtDate(detalhe?.vigencia)}</DialogDescription>
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap">{detalhe?.alteracao || "Sem descrição."}</p>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir registro?</DialogTitle>
            <DialogDescription>Essa ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => { if (confirmDelete) deleteMut.mutate(confirmDelete); setConfirmDelete(null); }}>Excluir</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FiltroSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Todos</SelectItem>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
