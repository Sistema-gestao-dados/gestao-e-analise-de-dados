import { useMemo, useState, memo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowUpDown, ArrowUp, ArrowDown, Plus, Trash2, Pencil, ChevronLeft, ChevronRight, Search, X,
} from "lucide-react";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";

export type ColumnDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "select";
  options?: string[] | (() => string[]);
  required?: boolean;
  editable?: boolean;
  sortable?: boolean;
  align?: "left" | "right";
  width?: string;
  format?: (v: any) => string;
};

export type CrudTableProps = {
  title: string;
  description?: string;
  table: string;
  pk: string;
  queryKey: string;
  columns: ColumnDef[];
  filters?: { key: string; label: string; options: () => string[] }[];
  initialPageSize?: number;
  clientFilter?: (row: Row) => boolean;
  toolbarExtras?: (ctx: { filteredRows: Row[] }) => React.ReactNode;
};

type Row = Record<string, any>;

export function CrudTable({
  title,
  description,
  table,
  pk,
  queryKey,
  columns,
  filters = [],
  initialPageSize = 25,
  toolbarExtras,
  clientFilter,
}: CrudTableProps) {
  const qc = useQueryClient();
  const dataQ = useQuery<Row[]>({
    queryKey: [queryKey],
    queryFn: async () => {
      const all: Row[] = [];
      const pageSize = 1000;
      let from = 0;
      for (;;) {
        const { data, error } = await (supabase as any).from(table).select("*").range(from, from + pageSize - 1);
        if (error) throw error;
        const chunk = (data ?? []) as Row[];
        all.push(...chunk);
        if (chunk.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  const rows = dataQ.data ?? [];

  const [q, setQ] = useState("");
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState<Row | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (clientFilter && !clientFilter(r)) return false;
      for (const f of filters) {
        const v = filterVals[f.key];
        if (v && v !== "__all" && String(r[f.key] ?? "") !== v) return false;
      }
      if (!ql) return true;
      return columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(ql));
    });
  }, [rows, q, filterVals, filters, columns, clientFilter]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const { key, dir } = sort;
    const m = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * m;
      return String(av).localeCompare(String(bv), "pt-BR", { numeric: true }) * m;
    });
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(
    () => sorted.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [sorted, safePage, pageSize],
  );

  const allPageChecked = pageRows.length > 0 && pageRows.every((r) => checked.has(String(r[pk])));
  const togglePage = useCallback(() => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allPageChecked) pageRows.forEach((r) => next.delete(String(r[pk])));
      else pageRows.forEach((r) => next.add(String(r[pk])));
      return next;
    });
  }, [allPageChecked, pageRows, pk]);

  const toggleAllFiltered = useCallback(() => {
    setChecked(new Set(sorted.map((r) => String(r[pk]))));
  }, [sorted, pk]);

  const toggleSort = (key: string) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const blankForm = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c.type === "number" ? "" : ""])) as Row,
    [columns],
  );

  function startCreate() {
    setCreating({ ...blankForm });
  }

  function validate(form: Row): string | null {
    for (const c of columns) {
      if (c.required && (form[c.key] == null || String(form[c.key]).trim() === "")) {
        return `${c.label} é obrigatório`;
      }
      if (c.type === "number" && form[c.key] !== "" && form[c.key] != null && Number.isNaN(Number(form[c.key]))) {
        return `${c.label} deve ser numérico`;
      }
    }
    return null;
  }

  function toPayload(form: Row): Row {
    const out: Row = {};
    for (const c of columns) {
      const v = form[c.key];
      if (c.type === "number") out[c.key] = v === "" || v == null ? null : Number(v);
      else out[c.key] = v === "" ? null : v;
    }
    return out;
  }

  async function saveEdit() {
    if (!editing) return;
    const err = validate(editing);
    if (err) { toast.error(err); return; }
    setSaving(true);
    const payload = toPayload(editing);
    const id = editing.__pk;
    const before = rows.find((r) => String(r[pk]) === String(id));
    const { error } = await (supabase as any).from(table).update(payload).eq(pk, id);
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Registro atualizado");
    void logAudit({ action: "update", entity: table, entity_id: id, details: { before, after: payload } });
    setEditing(null);
    qc.invalidateQueries({ queryKey: [queryKey] });
  }

  async function saveNew() {
    if (!creating) return;
    const err = validate(creating);
    if (err) { toast.error(err); return; }
    setSaving(true);
    const payload = toPayload(creating);
    const { data: inserted, error } = await (supabase as any).from(table).insert(payload).select().maybeSingle();
    setSaving(false);
    if (error) { toast.error("Erro ao incluir: " + error.message); return; }
    toast.success("Registro adicionado");
    void logAudit({ action: "create", entity: table, entity_id: inserted?.[pk] ?? null, details: { after: payload } });
    setCreating(null);
    qc.invalidateQueries({ queryKey: [queryKey] });
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setSaving(true);
    const ids = confirmDelete.ids;
    const beforeRows = rows.filter((r) => ids.includes(String(r[pk])));
    // Exclusão em lotes — evita "failed to fetch" quando há milhares de IDs
    const BATCH = 500;
    let deleted = 0;
    let firstError: string | null = null;
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const { error } = await (supabase as any).from(table).delete().in(pk, slice);
      if (error) { firstError = error.message; break; }
      deleted += slice.length;
      if (ids.length > BATCH) {
        toast.message(`Excluindo... ${deleted.toLocaleString("pt-BR")}/${ids.length.toLocaleString("pt-BR")}`, { id: "bulk-delete" });
      }
    }
    setSaving(false);
    if (firstError) {
      toast.error(`Erro ao excluir após ${deleted} registro(s): ${firstError}`, { id: "bulk-delete" });
      qc.invalidateQueries({ queryKey: [queryKey] });
      return;
    }
    toast.success(`${deleted.toLocaleString("pt-BR")} registro(s) excluído(s)`, { id: "bulk-delete" });
    void logAudit({ action: "delete", entity: table, entity_id: `bulk:${deleted}`, details: { count: deleted, sample: beforeRows.slice(0, 5) } });
    setChecked(new Set());
    setConfirmDelete(null);
    qc.invalidateQueries({ queryKey: [queryKey] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {checked.size > 0 && (
            <>
              <Badge variant="secondary">{checked.size} selecionado(s)</Badge>
              <Button variant="outline" size="sm" onClick={() => setChecked(new Set())}>
                <X className="h-4 w-4 mr-1" /> Limpar
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete({ ids: Array.from(checked) })}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir selecionados
              </Button>
            </>
          )}
          {toolbarExtras?.({ filteredRows: sorted })}
          <Button size="sm" onClick={startCreate}>
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        </div>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-3 space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto] items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Pesquisa rápida em todas as colunas..."
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {filters.map((f) => (
                <Select
                  key={f.key}
                  value={filterVals[f.key] ?? "__all"}
                  onValueChange={(v) => { setFilterVals((s) => ({ ...s, [f.key]: v })); setPage(0); }}
                >
                  <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder={f.label} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Todos · {f.label}</SelectItem>
                    {f.options().map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={allPageChecked} onCheckedChange={togglePage} />
                <span className="text-muted-foreground">Selecionar página</span>
              </label>
              {sorted.length > pageRows.length && (
                <button onClick={toggleAllFiltered} className="text-primary hover:underline">
                  Selecionar todos os {sorted.length} filtrados
                </button>
              )}
            </div>
            <div className="text-muted-foreground">
              {sorted.length} registro(s) · página {safePage + 1} de {totalPages}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="w-10 p-2.5"></th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      style={{ width: c.width, textAlign: c.align ?? "left" }}
                      className="p-2.5 select-none"
                    >
                      {c.sortable !== false ? (
                        <button
                          onClick={() => toggleSort(c.key)}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {c.label}
                          {sort?.key === c.key ? (
                            sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                  <th className="w-20 p-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const id = String(r[pk]);
                  return (
                    <RowItem
                      key={id}
                      row={r}
                      id={id}
                      columns={columns}
                      isChecked={checked.has(id)}
                      onToggle={() => {
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id); else next.add(id);
                          return next;
                        });
                      }}
                      onEdit={() => setEditing({ ...r, __pk: id })}
                      onDelete={() => setConfirmDelete({ ids: [id] })}
                    />
                  );
                })}
                {pageRows.length === 0 && (
                  <tr><td colSpan={columns.length + 2} className="text-center p-8 text-muted-foreground">
                    {dataQ.isLoading ? "Carregando..." : "Nenhum registro encontrado"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-2 p-3 border-t border-border flex-wrap">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Por página:</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(0); }}>
                <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs px-2 tabular-nums">{safePage + 1} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar registro</DialogTitle>
            <DialogDescription>Atualize os campos e clique em salvar.</DialogDescription>
          </DialogHeader>
          {editing && (
            <FormGrid form={editing} setForm={setEditing} columns={columns} mode="edit" />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novo registro</DialogTitle>
            <DialogDescription>Preencha os campos abaixo.</DialogDescription>
          </DialogHeader>
          {creating && (
            <FormGrid form={creating} setForm={setCreating} columns={columns} mode="create" />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(null)}>Cancelar</Button>
            <Button onClick={saveNew} disabled={saving}>{saving ? "Salvando..." : "Adicionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a excluir <strong>{confirmDelete?.ids.length}</strong> registro(s).
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const RowItem = memo(function RowItem({
  row, id, columns, isChecked, onToggle, onEdit, onDelete,
}: {
  row: Row; id: string; columns: ColumnDef[]; isChecked: boolean;
  onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <tr className="border-t border-border hover:bg-muted/40">
      <td className="p-2.5">
        <Checkbox checked={isChecked} onCheckedChange={onToggle} aria-label={`Selecionar ${id}`} />
      </td>
      {columns.map((c) => {
        const v = row[c.key];
        const display = c.format ? c.format(v) : v == null || v === "" ? "—" : String(v);
        return (
          <td key={c.key} style={{ textAlign: c.align ?? "left" }} className="p-2.5">
            {display}
          </td>
        );
      })}
      <td className="p-2.5 text-right whitespace-nowrap">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Editar">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete} aria-label="Excluir">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
});

function FormGrid({
  form, setForm, columns, mode,
}: {
  form: Row; setForm: (r: Row) => void; columns: ColumnDef[]; mode: "edit" | "create";
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {columns.map((c) => {
        const disabled = mode === "edit" && c.editable === false;
        const options = typeof c.options === "function" ? c.options() : c.options;
        return (
          <div key={c.key} className="space-y-1.5">
            <Label className="text-xs">{c.label}{c.required && " *"}</Label>
            {c.type === "select" && options ? (
              <Select
                value={String(form[c.key] ?? "")}
                onValueChange={(v) => setForm({ ...form, [c.key]: v })}
                disabled={disabled}
              >
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={c.type === "number" ? "number" : "text"}
                step={c.type === "number" ? "any" : undefined}
                value={form[c.key] ?? ""}
                onChange={(e) => setForm({ ...form, [c.key]: e.target.value })}
                disabled={disabled}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
