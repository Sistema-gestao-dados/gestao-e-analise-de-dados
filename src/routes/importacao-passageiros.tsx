import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchLinhas, fetchEmpresaEstacao } from "@/lib/data";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useAcessoDados } from "@/lib/acesso";
import {
  parsePlanilhaPax, salvarPassageiros, fetchMesesImportados, excluirPeriodo, somar,
  fmtNum, fmtReais, type ResultadoPlanilha,
} from "@/lib/passageiros";
import { logAudit } from "@/lib/audit";
import { useAuditView } from "@/lib/use-audit-view";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileUp, Loader2, ArrowRight, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/importacao-passageiros")({
  head: () => ({ meta: [{ title: "Importação Passageiros — Gestão e Análise de Dados" }] }),
  component: ImportacaoPassageirosPage,
});

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const fmtData = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

type Dono = { empresa: string | null; grupo: string | null; unidade: string | null };
const CADASTRO = "__cadastro";
const chaveDono = (d: Dono) => [d.empresa, d.grupo, d.unidade].map((x) => x ?? "").join("|");
const rotuloDono = (d: Dono) => [d.empresa, d.grupo, d.unidade].filter(Boolean).join(" · ") || "(sem empresa)";

function ImportacaoPassageirosPage() {
  useAuditView("importacao_passageiros");
  const qc = useQueryClient();
  const acesso = useAcessoDados();
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const mesesQ = useQuery({ queryKey: ["passageiros-meses"], queryFn: fetchMesesImportados });
  const eeQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  // Linha compartilhada -> chave do dono escolhido (lembrado entre importações).
  const [escolhas, setEscolhas] = usePersistentState<Record<string, string>>("passageiros.import.compartilhadas", {});

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lido, setLido] = useState<ResultadoPlanilha | null>(null);
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState<{ feitos: number; total: number } | null>(null);

  const cadastro = useMemo(() => new Set((linhasQ.data ?? []).map((l) => l.linha)), [linhasQ.data]);

  // Linhas compartilhadas (exceção por estação): a planilha não tem estação,
  // então quem importa escolhe a Empresa/Grupo/Unidade daquela linha.
  // Opções = cadastro da linha + cada exceção diferente dele.
  const compartilhadas = useMemo(() => {
    if (!lido) return [];
    const linhaMap = new Map((linhasQ.data ?? []).map((l) => [l.linha, l]));
    return lido.linhas.flatMap((linha) => {
      const exc = (eeQ.data ?? []).filter((e) => e.linha === linha);
      if (!exc.length) return [];
      const l = linhaMap.get(linha);
      const cad: Dono = { empresa: l?.empresa ?? null, grupo: l?.ordem ?? null, unidade: l?.unidade ?? null };
      const opcoes = new Map<string, Dono>();
      for (const e of exc) {
        const d: Dono = { empresa: e.empresa, grupo: e.grupo ?? cad.grupo, unidade: e.unidade ?? cad.unidade };
        if (chaveDono(d) !== chaveDono(cad)) opcoes.set(chaveDono(d), d);
      }
      return opcoes.size ? [{ linha, cad, opcoes }] : [];
    });
  }, [lido, eeQ.data, linhasQ.data]);
  // Sem escolha salva: a 1ª exceção (o cadastro da linha é justamente o que
  // a planilha costuma NÃO ser — ex.: 07/07A caíam em Expresso Tanguá).
  const escolhaDe = (c: { linha: string; opcoes: Map<string, Dono> }) => {
    const e = escolhas[c.linha];
    return e === CADASTRO || (e && c.opcoes.has(e)) ? e : c.opcoes.keys().next().value ?? CADASTRO;
  };
  const donoEscolhido = useMemo(() => {
    const m = new Map<string, Dono>();
    for (const c of compartilhadas) {
      const d = c.opcoes.get(escolhaDe(c));
      if (d) m.set(c.linha, d);
    }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compartilhadas, escolhas]);

  // Usuário restrito só grava as linhas do próprio Grupo/Empresa (o banco
  // recusaria o lote inteiro se viesse uma linha de fora).
  const analise = useMemo(() => {
    if (!lido) return null;
    const foraCadastro = lido.linhas.filter((l) => !cadastro.has(l));
    const foraAcesso = acesso.restrito
      ? lido.linhas.filter((l) => {
          const d = donoEscolhido.get(l);
          return d ? !acesso.podeValores(d.grupo, d.empresa) : !acesso.podeLinha(l);
        })
      : [];
    const bloqueadas = new Set(foraAcesso);
    const registros = lido.registros
      .filter((r) => !bloqueadas.has(r.linha))
      .map((r) => {
        const d = donoEscolhido.get(r.linha);
        return d ? { ...r, empresa: d.empresa, grupo: d.grupo, unidade: d.unidade } : r;
      });
    const semOperacao = lido.semOperacao.filter((r) => !bloqueadas.has(r.linha));
    return { foraCadastro, foraAcesso, registros, semOperacao, totais: somar(registros) };
  }, [lido, cadastro, acesso, donoEscolhido]);

  async function ler(f: File) {
    setArquivo(f);
    setLido(null);
    setLendo(true);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      setLido(parsePlanilhaPax(wb));
    } catch (e) {
      toast.error("Não foi possível ler a planilha", { description: (e as Error).message });
    } finally {
      setLendo(false);
    }
  }

  async function gravar() {
    if (!arquivo || !lido || !analise) return;
    setGravando({ feitos: 0, total: analise.registros.length });
    try {
      const { gravados, removidos } = await salvarPassageiros(
        analise.registros, analise.semOperacao, arquivo.name,
        (feitos, total) => setGravando({ feitos, total }),
      );
      await supabase.from("importacoes").insert({
        tipo: "Passageiros (DADOS PAX)",
        arquivo: arquivo.name,
        registros_inseridos: gravados,
        registros_atualizados: 0,
        registros_erro: 0,
        detalhes: { inicio: lido.datas[0], fim: lido.datas.at(-1), linhas: lido.linhas.length, removidos, fora_acesso: analise.foraAcesso },
      });
      void logAudit({ action: "import", entity: "passageiros_diario", details: { arquivo: arquivo.name, gravados, removidos, inicio: lido.datas[0], fim: lido.datas.at(-1) } });
      toast.success(`${fmtNum(gravados)} registro(s) gravado(s)`, {
        description: removidos ? `${removidos} dia(s) sem operação removido(s) do banco.` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["passageiros-meses"] });
      qc.invalidateQueries({ queryKey: ["passageiros"] });
      qc.invalidateQueries({ queryKey: ["importacoes"] });
      setArquivo(null);
      setLido(null);
    } catch (e) {
      toast.error("Erro ao gravar", { description: (e as Error).message });
    } finally {
      setGravando(null);
    }
  }

  async function excluirMes(inicio: string, fim: string, rotulo: string) {
    if (!window.confirm(`Excluir todos os dados de passageiros de ${rotulo}? Não tem como desfazer.`)) return;
    try {
      const n = await excluirPeriodo(inicio, fim);
      void logAudit({ action: "delete", entity: "passageiros_diario", details: { inicio, fim, registros: n } });
      toast.success(`${fmtNum(n)} registro(s) excluído(s)`);
      qc.invalidateQueries({ queryKey: ["passageiros-meses"] });
      qc.invalidateQueries({ queryKey: ["passageiros"] });
    } catch (e) {
      toast.error("Erro ao excluir", { description: (e as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Importação — Passageiros e Receita</h1>
          <p className="text-sm text-muted-foreground">Planilha DADOS PAX (.xlsx): um bloco de colunas por linha e uma linha por dia.</p>
        </div>
        <Button variant="outline" size="sm" asChild><Link to="/passageiros">Ver análise <ArrowRight className="h-4 w-4 ml-1" /></Link></Button>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileUp className="h-4 w-4 text-primary" /> Selecionar planilha</CardTitle>
          <CardDescription>
            Para cada linha: Viagens Realizadas, KM, Transportados, Pagantes, Receita e Gratuidades. Reimportar um período
            substitui os dados das linhas que estão no arquivo; "-" significa que a linha não rodou naquele dia.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            id="pax-file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); e.target.value = ""; }}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => document.getElementById("pax-file")?.click()} disabled={lendo || !!gravando}>
              {lendo ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              {arquivo ? arquivo.name : "Escolher arquivo"}
            </Button>
            <Button onClick={gravar} disabled={!analise || !analise.registros.length || !!gravando || acesso.carregando || eeQ.isLoading}>
              {gravando
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Gravando {fmtNum(gravando.feitos)}/{fmtNum(gravando.total)}...</>
                : "Gravar no sistema"}
            </Button>
          </div>

          {lido && analise && (
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Info rotulo="Período" valor={`${fmtData(lido.datas[0])} a ${fmtData(lido.datas.at(-1)!)}`} />
                <Info rotulo="Dias / Linhas" valor={`${lido.datas.length} dias · ${lido.linhas.length} linhas`} />
                <Info rotulo="Registros (linha × dia)" valor={`${fmtNum(analise.registros.length)} · ${fmtNum(analise.semOperacao.length)} sem operação`} />
                <Info rotulo="Transportados / Receita" valor={`${fmtNum(analise.totais.transportados)} · ${fmtReais(analise.totais.receita)}`} />
              </div>

              {lido.divergencias.length === 0 && !lido.avisos.length ? (
                <p className="text-sm flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" /> A soma dos dias bate com os "Totais" de cada mês da planilha.</p>
              ) : (
                <Alerta titulo={`${lido.divergencias.length} diferença(s) entre a soma dos dias e os "Totais" da planilha`} itens={[...lido.avisos, ...lido.divergencias]} />
              )}
              {analise.foraCadastro.length > 0 && (
                <Alerta
                  titulo="Linhas que não estão no Cadastro de Linhas — serão gravadas, mas aparecem sem Empresa/Grupo na análise até serem cadastradas"
                  itens={[analise.foraCadastro.join(", ")]}
                />
              )}
              {compartilhadas.length > 0 && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-2">
                  <div className="font-medium">Linhas compartilhadas entre empresas — escolha a quem pertence o dado da planilha</div>
                  <p className="text-xs text-muted-foreground">
                    Essas linhas têm exceção por estação no cadastro (Empresa por Estação). A planilha não informa estação, então
                    escolha aqui a Empresa/Grupo/Unidade de cada uma. A escolha fica salva para as próximas importações.
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {compartilhadas.map((c) => (
                      <div key={c.linha} className="flex items-center gap-2">
                        <span className="w-14 font-semibold text-primary">{c.linha}</span>
                        <Select value={escolhaDe(c)}
                          onValueChange={(v) => setEscolhas({ ...escolhas, [c.linha]: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={CADASTRO}>{rotuloDono(c.cad)} (cadastro da linha)</SelectItem>
                            {Array.from(c.opcoes, ([k, d]) => <SelectItem key={k} value={k}>{rotuloDono(d)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {analise.foraAcesso.length > 0 && (
                <Alerta titulo="Linhas fora do seu Grupo/Empresa — não serão gravadas" itens={[analise.foraAcesso.join(", ")]} />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-2"><CardTitle className="text-base">Períodos importados</CardTitle></CardHeader>
        <CardContent>
          {mesesQ.isLoading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>
          ) : mesesQ.error ? (
            <p className="text-sm text-destructive">Erro: {(mesesQ.error as Error).message}</p>
          ) : !mesesQ.data?.length ? (
            <p className="text-sm text-muted-foreground">Nenhum dado importado ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Dias</TableHead>
                  <TableHead className="text-right">Linhas</TableHead>
                  <TableHead className="text-right">Registros</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {mesesQ.data.map((m) => {
                  const rotulo = `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(0, 4)}`;
                  return (
                    <TableRow key={m.mes}>
                      <TableCell className="font-medium">{rotulo}</TableCell>
                      <TableCell>{fmtData(m.inicio)} a {fmtData(m.fim)}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.dias}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.linhas}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(m.registros)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" title={`Excluir ${rotulo}`} onClick={() => excluirMes(m.inicio, m.fim, rotulo)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="font-medium tabular-nums">{valor}</div>
    </div>
  );
}

function Alerta({ titulo, itens }: { titulo: string; itens: string[] }) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
      <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4 text-warning" /> {titulo}</div>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground max-h-40 overflow-y-auto">
        {itens.slice(0, 50).map((t, i) => <li key={i}>{t}</li>)}
      </ul>
      {itens.length > 50 && <Badge variant="outline" className="mt-1">+{itens.length - 50}</Badge>}
    </div>
  );
}
