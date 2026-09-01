// Painel de gerenciamento de "projetos ativos" — mostra todas as combinações
// (linha, tipo_operacao) existentes em viagens e permite ativar uma versão
// específica. Ativar substitui a anterior (única constraint linha+tipo_operacao).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchProjetosAtivos, ativarProjeto, desativarProjeto } from "@/lib/projeto-ativo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckCircle2, X, Search } from "lucide-react";
import { toast } from "sonner";

type Row = { linha: string; tipo_operacao: string; versoes: string[] };

async function fetchCombos(): Promise<Row[]> {
  const all: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await (supabase as any)
      .from("viagens")
      .select("linha,tipo_operacao,versao_programacao")
      .range(from, from + 999);
    if (error) throw error;
    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  const map = new Map<string, Set<string>>();
  for (const r of all) {
    if (!r.linha || !r.tipo_operacao || !r.versao_programacao) continue;
    const k = `${r.linha}||${r.tipo_operacao}`;
    if (!map.has(k)) map.set(k, new Set());
    map.get(k)!.add(r.versao_programacao);
  }
  return Array.from(map, ([k, versoes]) => {
    const [linha, tipo_operacao] = k.split("||");
    return { linha, tipo_operacao, versoes: Array.from(versoes).sort() };
  }).sort((a, b) => a.linha.localeCompare(b.linha) || a.tipo_operacao.localeCompare(b.tipo_operacao));
}

export function AtivosManager() {
  const qc = useQueryClient();
  const combosQ = useQuery({ queryKey: ["ativos-combos"], queryFn: fetchCombos });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });
  const [q, setQ] = useState("");

  const ativosMap = useMemo(() => {
    const m = new Map<string, string>();
    (ativosQ.data ?? []).forEach((a) => m.set(`${a.linha}||${a.tipo_operacao}`, a.versao_programacao));
    return m;
  }, [ativosQ.data]);

  const rows = useMemo(() => {
    const all = combosQ.data ?? [];
    if (!q) return all;
    const s = q.toLowerCase();
    return all.filter((r) => r.linha.toLowerCase().includes(s) || r.tipo_operacao.toLowerCase().includes(s));
  }, [combosQ.data, q]);

  async function onChangeAtivo(r: Row, versao: string) {
    try {
      if (versao === "__none") {
        await desativarProjeto(r.linha, r.tipo_operacao);
        toast.success(`${r.linha} / ${r.tipo_operacao}: sem projeto ativo`);
      } else {
        await ativarProjeto(r.linha, r.tipo_operacao, versao);
        toast.success(`${r.linha} / ${r.tipo_operacao}: ativado ${versao}`);
      }
      qc.invalidateQueries({ queryKey: ["projetos-ativos"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao alterar");
    }
  }

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" /> Projeto ativo por Linha × Dia Tipo
        </CardTitle>
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar linha…" className="h-8 pl-7 text-xs w-[220px]" />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[50vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Linha</TableHead>
                <TableHead>Dia Tipo</TableHead>
                <TableHead>Versões disponíveis</TableHead>
                <TableHead className="w-[260px]">Versão Ativa</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {combosQ.isLoading && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Carregando…</TableCell></TableRow>}
              {!combosQ.isLoading && !rows.length && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Nenhum combo encontrado.</TableCell></TableRow>}
              {rows.map((r) => {
                const key = `${r.linha}||${r.tipo_operacao}`;
                const atual = ativosMap.get(key) ?? "__none";
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{r.linha}</TableCell>
                    <TableCell>{r.tipo_operacao}</TableCell>
                    <TableCell><Badge variant="outline">{r.versoes.length}</Badge></TableCell>
                    <TableCell>
                      <Select value={atual} onValueChange={(v) => onChangeAtivo(r, v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">— sem ativo —</SelectItem>
                          {r.versoes.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {atual !== "__none" && (
                        <Button size="sm" variant="ghost" onClick={() => onChangeAtivo(r, "__none")} title="Desativar">
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
