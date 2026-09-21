// Wizard que detecta LINHAS ainda não mapeadas para um "tipo_operacao" (dia
// tipo) em um TXT recém-parseado, e permite ao usuário mapear cada dia tipo
// novo para HERDAR o comportamento de um dia tipo já existente (Dias úteis,
// Sábado, Domingo).
//
// A detecção é por PAR (dia tipo, linha) — não só pelo nome do dia tipo. Um
// dia tipo custom já usado antes, mas com linhas novas trazidas por uma
// importação posterior, ainda precisa mapear essas linhas novas: se já
// existe um pai conhecido em `dia_tipo_heranca`, a herança é reaplicada
// automaticamente (silenciosa, via `aplicarHerancaConhecida`); só abre o
// wizard pro que não tem pai conhecido ainda. Antes o app só perguntava na
// PRIMEIRA vez que via aquele nome de dia tipo, e linhas novas de
// importações seguintes ficavam sem `grupo_du` — órfãs nos relatórios
// agrupados por Grupo de Linha (Resumo por Grupo, Comparativo).
//
// A herança é persistida em DOIS lugares:
//  1. `parametro_multilinha` — para cada linha que já possui mapeamento no
//     dia tipo "pai", copiamos o mesmo `grupo_du` para o novo dia tipo.
//  2. `dia_tipo_heranca` — guarda QUAL foi o pai escolhido (ex.: "Feriado
//     SG 22-09-26" → "Dias úteis"), pra uso posterior no Comparativo (pra
//     decidir se uma linha sem dado deve repetir o pai, olhando o Grupo
//     de Linha inteiro dela, não só a linha isolada) e pra reaplicação
//     automática numa próxima importação desse mesmo dia tipo.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const PARENTS = ["Dias úteis", "Sábado", "Domingo"] as const;
const DIAS_TIPO_BASE = ["Dias úteis", "Sábado", "Domingo"];

export type DiaTipoNovo = { nome: string; linhas: string[] };

export type DiaTipoHerancaRow = { tipo_dia: string; tipo_dia_pai: string };

// Retorna array (não Map) de propósito: isso passa por useQuery/react-query
// (ver comparativo-view.tsx), que persiste o cache no localStorage via
// JSON — um Map vira `{}` nesse round-trip (perde o protótipo) e quebra
// `.get()` na primeira carga depois de um reload. Quem consome monta o Map
// localmente (useMemo no Comparativo; direto aqui embaixo em
// aplicarHerancaConhecida, que nunca passa pelo cache do react-query).
export async function fetchDiaTipoHeranca(): Promise<DiaTipoHerancaRow[]> {
  const { data, error } = await supabase.from("dia_tipo_heranca").select("tipo_dia,tipo_dia_pai");
  if (error) throw error;
  return (data ?? []) as DiaTipoHerancaRow[];
}

export function buildDiaTipoHerancaMap(rows: DiaTipoHerancaRow[]): Map<string, string> {
  return new Map(rows.map((r) => [r.tipo_dia, r.tipo_dia_pai]));
}

/** Copia (linha, grupo_du) do dia tipo `parent` pra `tipoNovo`, só pras
 *  `linhas` informadas. Usado pelo wizard manual e pela reaplicação
 *  automática de herança já conhecida. */
async function copiarGrupoDoParent(parent: string, tipoNovo: string, linhas: string[]) {
  if (!linhas.length) return;
  const { data, error } = await supabase
    .from("parametro_multilinha")
    .select("linha,grupo_du")
    .eq("tipo_dia", parent)
    .in("linha", linhas);
  if (error) throw error;
  const payload = (data ?? []).map((r: any) => ({ linha: r.linha, grupo_du: r.grupo_du, tipo_dia: tipoNovo }));
  if (!payload.length) return;
  const size = 200;
  for (let i = 0; i < payload.length; i += size) {
    const { error: e } = await supabase
      .from("parametro_multilinha")
      .upsert(payload.slice(i, i + size), { onConflict: "linha,grupo_du,tipo_dia", ignoreDuplicates: true });
    if (e) throw e;
  }
}

/** Para dias tipo que JÁ têm um pai registrado em `dia_tipo_heranca`,
 *  reaplica a herança automaticamente (sem perguntar de novo) pras linhas
 *  que ainda não têm `parametro_multilinha` — caso de uma importação
 *  posterior do mesmo dia tipo trazendo linhas novas. Retorna só os itens
 *  SEM pai conhecido, que ainda precisam do wizard. */
export async function aplicarHerancaConhecida(novos: DiaTipoNovo[]): Promise<DiaTipoNovo[]> {
  if (!novos.length) return novos;
  const herancaMap = buildDiaTipoHerancaMap(await fetchDiaTipoHeranca());
  const semPai: DiaTipoNovo[] = [];
  let algumAplicado = false;
  for (const nv of novos) {
    const parent = herancaMap.get(nv.nome);
    if (!parent) { semPai.push(nv); continue; }
    await copiarGrupoDoParent(parent, nv.nome, nv.linhas);
    algumAplicado = true;
  }
  if (algumAplicado) toast.success("Grupo de linha atualizado automaticamente para dia(s) tipo já mapeado(s) antes.");
  return semPai;
}

export function DiaTipoMapper({
  novos, open, onClose,
}: {
  novos: DiaTipoNovo[];
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      for (const nv of novos) {
        const parent = map[nv.nome];
        if (!parent) continue;
        await copiarGrupoDoParent(parent, nv.nome, nv.linhas);
        // guarda a associação em si, pra uso posterior (Comparativo, e pra
        // reaplicação automática numa próxima importação desse dia tipo)
        const { error: e2 } = await supabase
          .from("dia_tipo_heranca")
          .upsert({ tipo_dia: nv.nome, tipo_dia_pai: parent }, { onConflict: "tipo_dia" });
        if (e2) throw e2;
      }
      toast.success("Dia(s) tipo mapeado(s) com sucesso");
      qc.invalidateQueries({ queryKey: ["multi"] });
      qc.invalidateQueries({ queryKey: ["dias-tipo-cadastrados"] });
      qc.invalidateQueries({ queryKey: ["dia-tipo-heranca"] });
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
                <p className="text-[11px] text-muted-foreground">
                  {nv.linhas.length > 0 ? `${nv.linhas.length} linha(s)` : "sem arquivo importado ainda — só define o pai"}
                </p>
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

/** Detecta pares (dia tipo, linha) do arquivo recém-parseado que AINDA não
 *  têm `grupo_du` em `parametro_multilinha` — inclui tanto dia tipo
 *  totalmente novo quanto dia tipo já conhecido com linhas novas. Ignora os
 *  3 dias tipo básicos (assumidos já cadastrados manualmente). */
export async function detectarNovosDiasTipo(
  rowsParseados: { linha: string; tipo_operacao: string | null }[],
): Promise<DiaTipoNovo[]> {
  const grupo = new Map<string, Set<string>>();
  for (const r of rowsParseados) {
    const t = r.tipo_operacao?.trim();
    if (!t || DIAS_TIPO_BASE.includes(t)) continue;
    if (!grupo.has(t)) grupo.set(t, new Set());
    grupo.get(t)!.add(r.linha);
  }
  if (!grupo.size) return [];
  const { data } = await supabase.from("parametro_multilinha").select("linha,tipo_dia");
  const existentes = new Set(((data ?? []) as any[]).map((r) => `${r.tipo_dia}||${r.linha}`));
  const novos: DiaTipoNovo[] = [];
  for (const [tipo, linhas] of grupo) {
    const faltando = Array.from(linhas).filter((l) => !existentes.has(`${tipo}||${l}`)).sort();
    if (!faltando.length) continue;
    novos.push({ nome: tipo, linhas: faltando });
  }
  return novos;
}
