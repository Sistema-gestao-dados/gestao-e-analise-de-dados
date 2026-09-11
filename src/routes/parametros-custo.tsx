import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchParametrosCusto, salvarParametrosCusto, valorHora, fmtMoeda, type ParametrosCusto } from "@/lib/custo";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Save, DollarSign } from "lucide-react";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/parametros-custo")({
  head: () => ({ meta: [{ title: "Parâmetros de Custo — Gestão e Análise de Dados" }] }),
  component: ParametrosCustoPage,
});

function minToHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function ParametrosCustoPage() {
  useAuditView("parametros_custo");
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["parametros-custo"], queryFn: fetchParametrosCusto });
  const [form, setForm] = useState<ParametrosCusto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (q.data && !form) setForm(q.data); }, [q.data, form]);

  async function salvar() {
    if (!form) return;
    setSaving(true);
    try {
      await salvarParametrosCusto(form);
      void logAudit({ action: "update", entity: "parametros_custo", details: form as any });
      qc.invalidateQueries({ queryKey: ["parametros-custo"] });
      qc.invalidateQueries({ queryKey: ["salario-motorista"] });
      toast.success("Parâmetros salvos");
    } catch (e) {
      toast.error("Erro ao salvar", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Acesso exclusivo de administrador.</CardContent></Card>;
  }
  if (q.isLoading || !form) {
    return <Card><CardContent className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></CardContent></Card>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2"><DollarSign className="h-6 w-6 text-primary" /> Parâmetros de Custo</h1>
        <p className="text-sm text-muted-foreground">Regras do acordo coletivo, usadas pra calcular custo de mão de obra em todos os relatórios. Só administrador edita.</p>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Salário e percentuais</CardTitle>
          <CardDescription>Valor/hora calculado: <strong>{fmtMoeda(valorHora(form))}</strong></CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Salário do motorista (mensal, R$)</Label>
            <Input type="number" step="0.01" value={form.salarioMotoristaMensal} onChange={(e) => setForm({ ...form, salarioMotoristaMensal: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Horas mensais de referência</Label>
            <Input type="number" step="0.01" value={form.horasMensaisReferencia} onChange={(e) => setForm({ ...form, horasMensaisReferencia: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Hora extra (%)</Label>
            <Input type="number" step="0.01" value={form.horaExtraPercentual} onChange={(e) => setForm({ ...form, horaExtraPercentual: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Adicional noturno (%)</Label>
            <Input type="number" step="0.01" value={form.adicionalNoturnoPercentual} onChange={(e) => setForm({ ...form, adicionalNoturnoPercentual: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Encargos sociais (%)</Label>
            <Input type="number" step="0.01" value={form.encargosPercentual} onChange={(e) => setForm({ ...form, encargosPercentual: Number(e.target.value) })} />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Janela do adicional noturno</CardTitle>
          <CardDescription>Minutos do serviço dentro dessa janela recebem o adicional.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <Label>Início</Label>
            <Input type="time" value={minToHHMM(form.noturnoInicioMin)} onChange={(e) => setForm({ ...form, noturnoInicioMin: hhmmToMin(e.target.value) })} />
          </div>
          <div>
            <Label>Fim</Label>
            <Input type="time" value={minToHHMM(form.noturnoFimMin)} onChange={(e) => setForm({ ...form, noturnoFimMin: hhmmToMin(e.target.value) })} />
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base">Janela permitida do regime de TU</CardTitle>
          <CardDescription>Usada no alerta da tela Intra Jornada — TU não pode começar antes disso, nem terminar depois.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <Label>Início mínimo</Label>
            <Input type="time" value={minToHHMM(form.tuInicioMinimoMin)} onChange={(e) => setForm({ ...form, tuInicioMinimoMin: hhmmToMin(e.target.value) })} />
          </div>
          <div>
            <Label>Fim máximo</Label>
            <Input type="time" value={minToHHMM(form.tuFimMaximoMin)} onChange={(e) => setForm({ ...form, tuFimMaximoMin: hhmmToMin(e.target.value) })} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={salvar} disabled={saving}>
          {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : <><Save className="h-4 w-4 mr-2" />Salvar parâmetros</>}
        </Button>
      </div>
    </div>
  );
}
