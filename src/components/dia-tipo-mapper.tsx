// Wizard que detecta novos "tipo_operacao" (dia tipo) em um TXT recém-parseado
// e permite ao usuário mapear cada novo dia tipo para HERDAR o comportamento
// de um dia tipo já existente (Dias úteis, Sábado, Domingo).
//
// A herança é persistida em `parametro_multilinha` — para cada linha que
// já possui mapeamento no dia tipo "pai", copiamos o mesmo `grupo_du` para
// o novo dia tipo. Assim os relatórios que agrupam por (linha, tipo_dia)
// funcionam automaticamente para os feriados / datas especiais.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const PARENTS = ["Dias úteis", "Sábado", "Domingo"] as const;

export type DiaTipoNovo = { nome: string; linhas: string[] };

export function DiaTipoMapper({
  novos, open, onClose,
}: {
  novos: DiaTipoNovo[];
  open: boolean;
  onClose: () => void;
}) {
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      for (const nv of novos) {
        const parent = map[nv.nome];
        if (!parent) continue;
        // busca mapeamentos existentes (linha, grupo_du) do parent
        const { data } = await supabase
          .from("parametro_multilinha")
          .select("linha,grupo_du")
          .eq("tipo_dia", parent)
          .in("linha", nv.linhas);
        const payload = (data ?? []).map((r: any) => ({
          linha: r.linha, grupo_du: r.grupo_du, tipo_dia: nv.nome,
        }));
        if (!payload.length) continue;
        // insert com ignoreDuplicates (unique = linha, grupo_du, tipo_dia)
        const size = 200;
        for (let i = 0; i < payload.length; i += size) {
          const { error } = await supabase
            .from("parametro_multilinha")
            .upsert(payload.slice(i, i + size), { onConflict: "linha,grupo_du,tipo_dia", ignoreDuplicates: true });
          if (error) throw error;
        }
      }
      toast.success("Dia(s) tipo mapeado(s) com sucesso");
      onClose();
    } catch (e: any) {
      toast.error(`Falha: ${e?.message ?? "erro"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novos dias tipo detectados</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Escolha de qual dia tipo cada novo item deve <strong>herdar o comportamento</strong> (grupos de linha, etc.).
          </p>
        </DialogHeader>
        <div className="space-y-3">
          {novos.map((nv) => (
            <div key={nv.nome} className="flex items-center justify-between gap-3 border rounded-md p-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{nv.nome}</p>
                <p className="text-[11px] text-muted-foreground">{nv.linhas.length} linha(s)</p>
              </div>
              <Select value={map[nv.nome] ?? ""} onValueChange={(v) => setMap((m) => ({ ...m, [nv.nome]: v }))}>
                <SelectTrigger className="w-[180px] h-9 text-xs">
                  <SelectValue placeholder="Herdar de..." />
                </SelectTrigger>
                <SelectContent>
                  {PARENTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Pular</Button>
          <Button onClick={confirm} disabled={busy}>Aplicar mapeamento</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Detecta dias tipo que ainda não existem em `parametro_multilinha`. */
export async function detectarNovosDiasTipo(
  rowsParseados: { linha: string; tipo_operacao: string | null }[],
): Promise<DiaTipoNovo[]> {
  const grupo = new Map<string, Set<string>>();
  for (const r of rowsParseados) {
    const t = r.tipo_operacao?.trim();
    if (!t) continue;
    if (!grupo.has(t)) grupo.set(t, new Set());
    grupo.get(t)!.add(r.linha);
  }
  if (!grupo.size) return [];
  const { data } = await supabase.from("parametro_multilinha").select("tipo_dia");
  const existentes = new Set(((data ?? []) as any[]).map((r) => r.tipo_dia));
  const novos: DiaTipoNovo[] = [];
  for (const [tipo, linhas] of grupo) {
    if (existentes.has(tipo)) continue;
    // ignora os básicos já conhecidos
    if (tipo === "Dias úteis" || tipo === "Sábado" || tipo === "Domingo") continue;
    novos.push({ nome: tipo, linhas: Array.from(linhas).sort() });
  }
  return novos;
}
