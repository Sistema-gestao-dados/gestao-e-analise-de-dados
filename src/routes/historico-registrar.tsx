import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchLinhas } from "@/lib/data";
import { fetchHistoricoDiaTipos, ensureDiaTipo, insertHistorico } from "@/lib/historico";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Save, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/historico-registrar")({
  head: () => ({ meta: [{ title: "Registrar Reprogramação — Gestão e Análise de Dados" }] }),
  component: RegistrarPage,
});

function RegistrarPage() {
  useAuditView("historico_reprogramacao_registrar");
  const qc = useQueryClient();
  const navigate = useNavigate();

  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const diaTiposQ = useQuery({ queryKey: ["historico-dia-tipos"], queryFn: fetchHistoricoDiaTipos });
  const linhas = linhasQ.data ?? [];
  const diaTipos = diaTiposQ.data ?? [];

  const [form, setForm] = useState({
    linha: "", versao: "", dia_tipo: "", novoDiaTipo: "",
    data_solicitacao: "", vigencia: "", encerramento: "", alteracao: "", ativo: true,
  });
  const [saving, setSaving] = useState(false);
  const usandoNovoDiaTipo = form.dia_tipo === "__novo__";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.linha) { toast.error("Linha é obrigatória"); return; }
    setSaving(true);
    try {
      let diaTipoFinal = form.dia_tipo;
      if (usandoNovoDiaTipo) {
        if (!form.novoDiaTipo.trim()) { toast.error("Informe o novo Dia tipo"); setSaving(false); return; }
        diaTipoFinal = form.novoDiaTipo.trim();
        await ensureDiaTipo(diaTipoFinal);
      }
      const created = await insertHistorico({
        linha: form.linha,
        versao: form.versao ? Number(form.versao) : null,
        dia_tipo: diaTipoFinal || null,
        data_solicitacao: form.data_solicitacao || null,
        vigencia: form.vigencia || null,
        encerramento: form.encerramento || null,
        alteracao: form.alteracao || null,
        ativo: form.ativo,
      });
      void logAudit({ action: "create", entity: "historico_reprogramacao", entity_id: created.id, details: { linha: form.linha, vigencia: form.vigencia } });
      toast.success("Reprogramação registrada");
      qc.invalidateQueries({ queryKey: ["historico-reprogramacao"] });
      qc.invalidateQueries({ queryKey: ["historico-dia-tipos"] });
      navigate({ to: "/historico-consultar" });
    } catch (err) {
      toast.error("Erro ao salvar", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button variant="ghost" size="sm" asChild><Link to="/historico-consultar"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" /> Nova reprogramação</CardTitle>
          <CardDescription>Preencha os campos para registrar uma nova alteração no histórico.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>Linha *</Label>
              <Select value={form.linha} onValueChange={(v) => setForm((f) => ({ ...f, linha: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {linhas.map((l) => <SelectItem key={l.linha} value={l.linha}>{l.linha}{l.empresa ? ` — ${l.empresa}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Versão</Label>
              <Input type="number" value={form.versao} onChange={(e) => setForm((f) => ({ ...f, versao: e.target.value }))} />
            </div>
            <div>
              <Label>Dia tipo</Label>
              <Select value={form.dia_tipo} onValueChange={(v) => setForm((f) => ({ ...f, dia_tipo: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione ou crie" /></SelectTrigger>
                <SelectContent>
                  {diaTipos.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  <SelectItem value="__novo__">+ Criar novo...</SelectItem>
                </SelectContent>
              </Select>
              {usandoNovoDiaTipo && (
                <Input className="mt-2" placeholder="Nome do novo dia tipo" value={form.novoDiaTipo} onChange={(e) => setForm((f) => ({ ...f, novoDiaTipo: e.target.value }))} />
              )}
            </div>
            <div>
              <Label>Ativo</Label>
              <Select value={form.ativo ? "S" : "N"} onValueChange={(v) => setForm((f) => ({ ...f, ativo: v === "S" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="S">Sim</SelectItem><SelectItem value="N">Não</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data de solicitação</Label>
              <Input type="date" value={form.data_solicitacao} onChange={(e) => setForm((f) => ({ ...f, data_solicitacao: e.target.value }))} />
            </div>
            <div>
              <Label>Vigência</Label>
              <Input type="date" value={form.vigencia} onChange={(e) => setForm((f) => ({ ...f, vigencia: e.target.value }))} />
            </div>
            <div>
              <Label>Encerramento</Label>
              <Input type="date" value={form.encerramento} onChange={(e) => setForm((f) => ({ ...f, encerramento: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Label>Alteração</Label>
              <Textarea rows={4} value={form.alteracao} onChange={(e) => setForm((f) => ({ ...f, alteracao: e.target.value }))} placeholder="Descreva o que mudou nessa reprogramação..." />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" /> {saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
