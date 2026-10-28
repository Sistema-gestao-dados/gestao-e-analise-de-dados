import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { fetchHistorico, buildGrupoParaLinhas, numeroVersao, diaTipoBase, chaveLinha, type Historico, type DiaTipoBase } from "@/lib/historico";
import { fetchMulti } from "@/lib/data";
import { fetchAllViagens } from "@/lib/viagens";
import { fetchProjetosAtivos } from "@/lib/projeto-ativo";
import { fetchDiaTipoHeranca } from "@/components/dia-tipo-mapper";
import { useAuditView } from "@/lib/use-audit-view";
import { logAudit } from "@/lib/audit";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Download, Loader2 } from "lucide-react";

export const Route = createFileRoute("/historico-conferencia")({
  head: () => ({ meta: [{ title: "Conferência Histórico × Versões — Gestão e Análise de Dados" }] }),
  component: ConferenciaPage,
});

// Cruza as versões importadas (viagens: linha + dia tipo + "Projeto /
// Versão") com o Histórico de Reprogramação (linha + dia tipo + nº da
// versão). O Histórico só guarda o NÚMERO da versão e, muitas vezes, uma
// linha só do grupo (ex.: lançado na 01, vale pra 01A) — por isso:
//  - o número sai do texto da versão (numeroVersao, lib/historico.ts);
//  - a linha casa direto OU por qualquer linha do mesmo Grupo de Linha
//    (Cadastro de Grupos, sem distinguir dia tipo — igual às outras telas
//    do Histórico);
//  - o dia tipo é comparado pelo dia "base" (Dias úteis/Sábado/Domingo):
//    o Histórico tem vocabulário próprio (DU, SAB...) e dia tipo especial
//    das viagens (feriado) usa o dia pai registrado na importação.

type Situacao = "direto" | "grupo" | "outro_dia" | "nao_encontrado" | "sem_numero";

const SIT: Record<Situacao, { label: string; desc: string; className: string }> = {
  direto: { label: "Achou na linha", desc: "Registro do Histórico na própria linha", className: "border-success/30 bg-success/10 text-success" },
  grupo: { label: "Achou pelo grupo", desc: "Registro lançado em outra linha do mesmo Grupo de Linha", className: "border-primary/30 bg-primary/10 text-primary" },
  outro_dia: { label: "Outro dia tipo", desc: "Versão existe no Histórico da linha/grupo, mas em outro dia tipo", className: "border-warning/30 bg-warning/10 text-warning" },
  nao_encontrado: { label: "Não está no Histórico", desc: "Versão importada sem registro no Histórico", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  sem_numero: { label: "Sem nº de versão", desc: "Não deu pra ler o número no texto da versão", className: "border-muted-foreground/30 bg-muted text-muted-foreground" },
};
const ORDEM_SIT: Situacao[] = ["nao_encontrado", "outro_dia", "sem_numero", "grupo", "direto"];

const DIAS_BASE = ["Dias úteis", "Sábado", "Domingo"];

type LinhaConf = {
  linha: string;
  diaTipo: string;
  diaBase: DiaTipoBase | null;
  versaoTexto: string;
  numero: number | null;
  viagens: number;
  ativa: boolean;
  situacao: Situacao;
  registro: Historico | null;
};

type SoHistorico = { h: Historico; motivo: string };

function fmtDate(d?: string | null) {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** Registro mais recente (maior vigência). */
function maisRecente(hs: Historico[]): Historico | null {
  return hs.reduce<Historico | null>((best, h) => (!best || (h.vigencia ?? "") > (best.vigencia ?? "") ? h : best), null);
}

const POR_PAGINA = 100;

function ConferenciaPage() {
  useAuditView("historico_conferencia");
  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const historicoQ = useQuery({ queryKey: ["historico-reprogramacao"], queryFn: fetchHistorico });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const herancaQ = useQuery({ queryKey: ["dia-tipo-heranca"], queryFn: fetchDiaTipoHeranca });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });
  const carregando = viagensQ.isLoading || historicoQ.isLoading || multiQ.isLoading || herancaQ.isLoading || ativosQ.isLoading;

  const [visao, setVisao] = usePersistentState<"importadas" | "so_historico">("conferencia.visao", "importadas");
  const [fSit, setFSit] = usePersistentState<Situacao | "__all">("conferencia.fSit", "__all");
  const [fDia, setFDia] = usePersistentState("conferencia.fDia", "__all");
  const [fLinha, setFLinha] = useState("");
  const [somenteAtivas, setSomenteAtivas] = usePersistentState("conferencia.somenteAtivas", false);
  const [pagina, setPagina] = useState(0);

  // Linhas "irmãs" de cada linha (mesmo Grupo de Linha, qualquer dia tipo).
  const irmas = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const linhas of buildGrupoParaLinhas(multiQ.data ?? []).values()) {
      for (const l of linhas) {
        const k = chaveLinha(l);
        if (!m.has(k)) m.set(k, new Set());
        for (const o of linhas) m.get(k)!.add(chaveLinha(o));
      }
    }
    return m;
  }, [multiQ.data]);
  // "1" = "01" (chaveLinha): o Histórico pode ter a linha sem o zero.
  const mesmaLinhaOuGrupo = (a: string, b: string) => chaveLinha(a) === chaveLinha(b) || !!irmas.get(chaveLinha(a))?.has(chaveLinha(b));

  const heranca = useMemo(() => new Map((herancaQ.data ?? []).map((r) => [r.tipo_dia, r.tipo_dia_pai])), [herancaQ.data]);
  // Dia base de um dia tipo das viagens: base direto, senão dia pai
  // herdado na importação, senão pelo próprio texto ("Dias úteis - 1 Quinz.").
  const baseViagem = (dia: string): DiaTipoBase | null =>
    (DIAS_BASE.includes(dia) ? (dia as DiaTipoBase) : null) ?? diaTipoBase(heranca.get(dia)) ?? diaTipoBase(dia);
  const diaCompativel = (h: Historico, diaViagem: string, base: DiaTipoBase | null) => {
    if (!h.dia_tipo?.trim()) return true; // Histórico sem dia tipo: não descarta
    const hb = diaTipoBase(h.dia_tipo);
    if (hb && base) return hb === base;
    return norm(h.dia_tipo) === norm(diaViagem);
  };

  const { conferencia, soHistorico } = useMemo(() => {
    const historico = historicoQ.data ?? [];
    const porNumero = new Map<number, Historico[]>();
    for (const h of historico) {
      if (h.versao == null) continue;
      if (!porNumero.has(h.versao)) porNumero.set(h.versao, []);
      porNumero.get(h.versao)!.push(h);
    }
    const ativas = new Set((ativosQ.data ?? []).map((a) => `${a.linha}||${a.tipo_operacao}||${a.versao_programacao}`));

    // Versões importadas: uma por linha + dia tipo + texto da versão.
    const combos = new Map<string, { linha: string; dia: string; versao: string; n: number }>();
    for (const v of viagensQ.data ?? []) {
      if (!v.versao_programacao) continue;
      const k = `${v.linha}||${v.tipo_operacao ?? ""}||${v.versao_programacao}`;
      const c = combos.get(k);
      if (c) c.n++;
      else combos.set(k, { linha: v.linha, dia: v.tipo_operacao ?? "", versao: v.versao_programacao, n: 1 });
    }

    const out: LinhaConf[] = [];
    for (const [k, c] of combos) {
      const numero = numeroVersao(c.versao);
      const diaBase = baseViagem(c.dia);
      const base = { linha: c.linha, diaTipo: c.dia, diaBase, versaoTexto: c.versao, numero, viagens: c.n, ativa: ativas.has(k) };
      if (numero == null) { out.push({ ...base, situacao: "sem_numero", registro: null }); continue; }
      const cands = porNumero.get(numero) ?? [];
      const doGrupo = cands.filter((h) => mesmaLinhaOuGrupo(c.linha, h.linha));
      const compat = doGrupo.filter((h) => diaCompativel(h, c.dia, diaBase));
      const diretos = compat.filter((h) => chaveLinha(h.linha) === chaveLinha(c.linha));
      if (diretos.length) out.push({ ...base, situacao: "direto", registro: maisRecente(diretos) });
      else if (compat.length) out.push({ ...base, situacao: "grupo", registro: maisRecente(compat) });
      else if (doGrupo.length) out.push({ ...base, situacao: "outro_dia", registro: maisRecente(doGrupo) });
      else out.push({ ...base, situacao: "nao_encontrado", registro: null });
    }
    out.sort((a, b) =>
      a.linha.localeCompare(b.linha, "pt-BR", { numeric: true })
      || a.diaTipo.localeCompare(b.diaTipo, "pt-BR")
      || (a.numero ?? 0) - (b.numero ?? 0));

    // Caminho inverso: registros do Histórico sem nenhuma versão importada
    // que case (mesma regra de linha/grupo e dia tipo).
    const so: SoHistorico[] = [];
    const combosLista = Array.from(combos.values()).map((c) => ({ ...c, numero: numeroVersao(c.versao), diaBase: baseViagem(c.dia) }));
    for (const h of historico) {
      if (h.versao == null) { so.push({ h, motivo: "Registro sem nº de versão" }); continue; }
      const mesmos = combosLista.filter((c) => c.numero === h.versao && mesmaLinhaOuGrupo(h.linha, c.linha));
      if (mesmos.some((c) => diaCompativel(h, c.dia, c.diaBase))) continue;
      so.push({ h, motivo: mesmos.length ? "Versão importada só em outro dia tipo" : "Versão não importada no sistema" });
    }
    so.sort((a, b) => a.h.linha.localeCompare(b.h.linha, "pt-BR", { numeric: true }) || (b.h.vigencia ?? "").localeCompare(a.h.vigencia ?? ""));

    return { conferencia: out, soHistorico: so };
  }, [viagensQ.data, historicoQ.data, ativosQ.data, irmas, heranca]);

  const opcoesDia = useMemo(() => Array.from(new Set(conferencia.map((c) => c.diaTipo).filter(Boolean))).sort(), [conferencia]);

  const filtradas = useMemo(() => {
    const busca = norm(fLinha);
    return conferencia.filter((c) => {
      if (fSit !== "__all" && c.situacao !== fSit) return false;
      if (fDia !== "__all" && c.diaTipo !== fDia) return false;
      if (somenteAtivas && !c.ativa) return false;
      if (busca && !norm(c.linha).includes(busca) && !norm(c.versaoTexto).includes(busca)) return false;
      return true;
    });
  }, [conferencia, fSit, fDia, somenteAtivas, fLinha]);

  const soHistFiltrado = useMemo(() => {
    const busca = norm(fLinha);
    return busca ? soHistorico.filter((s) => norm(s.h.linha).includes(busca)) : soHistorico;
  }, [soHistorico, fLinha]);

  const contagem = useMemo(() => {
    const base = conferencia.filter((c) => !somenteAtivas || c.ativa);
    const m = new Map<Situacao, number>();
    for (const c of base) m.set(c.situacao, (m.get(c.situacao) ?? 0) + 1);
    return m;
  }, [conferencia, somenteAtivas]);

  useEffect(() => setPagina(0), [visao, fSit, fDia, somenteAtivas, fLinha]);

  const lista = visao === "importadas" ? filtradas : soHistFiltrado;
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const pag = Math.min(pagina, totalPaginas - 1);

  function exportar() {
    const wb = XLSX.utils.book_new();
    const conf = filtradas.map((c) => ({
      Linha: c.linha,
      "Dia tipo": c.diaTipo,
      "Dia base": c.diaBase ?? "",
      "Projeto / Versão": c.versaoTexto,
      "Nº versão": c.numero ?? "",
      Viagens: c.viagens,
      "Versão ativa": c.ativa ? "Sim" : "Não",
      Situação: SIT[c.situacao].label,
      "Linha no Histórico": c.registro?.linha ?? "",
      "Dia tipo no Histórico": c.registro?.dia_tipo ?? "",
      Referência: c.registro?.referencia ?? "",
      Vigência: fmtDate(c.registro?.vigencia),
      Encerramento: fmtDate(c.registro?.encerramento),
      Alteração: c.registro?.alteracao ?? "",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(conf), "Versões importadas");
    const so = soHistFiltrado.map((s) => ({
      Linha: s.h.linha,
      "Dia tipo": s.h.dia_tipo ?? "",
      "Nº versão": s.h.versao ?? "",
      Referência: s.h.referencia ?? "",
      Vigência: fmtDate(s.h.vigencia),
      Encerramento: fmtDate(s.h.encerramento),
      Alteração: s.h.alteracao ?? "",
      Motivo: s.motivo,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(so), "Só no Histórico");
    XLSX.writeFile(wb, `conferencia_historico_versoes_${new Date().toISOString().slice(0, 10)}.xlsx`);
    void logAudit({ action: "export", entity: "historico_conferencia", details: { versoes: conf.length, so_historico: so.length } });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-1 -ml-2"><Link to="/historico-consultar"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Conferência — Histórico × Versões importadas</h1>
          <p className="text-sm text-muted-foreground">
            Cruza linha + dia tipo + nº da versão. A linha casa direto ou por outra linha do mesmo Grupo de Linha (ex.: lançado na 01, vale pra 01A).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={carregando}>
          <Download className="h-4 w-4 mr-1" /> Exportar Excel
        </Button>
      </div>

      {carregando ? (
        <Card><CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando viagens e histórico...</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-2 grid-cols-2 md:grid-cols-5">
            {ORDEM_SIT.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setVisao("importadas"); setFSit(fSit === s ? "__all" : s); }}
                className={`rounded-lg border p-3 text-left transition ${SIT[s].className} ${fSit === s && visao === "importadas" ? "ring-2 ring-ring" : ""}`}
                title={SIT[s].desc}
              >
                <div className="text-[11px] font-medium">{SIT[s].label}</div>
                <div className="text-2xl font-semibold tabular-nums">{(contagem.get(s) ?? 0).toLocaleString("pt-BR")}</div>
              </button>
            ))}
          </div>

          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="p-3 flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1 min-w-[190px]">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Visão</label>
                <Select value={visao} onValueChange={(v) => setVisao(v as typeof visao)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="importadas">Versões importadas ({conferencia.length.toLocaleString("pt-BR")})</SelectItem>
                    <SelectItem value="so_historico">Só no Histórico ({soHistorico.length.toLocaleString("pt-BR")})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1 min-w-[160px]">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Linha / versão</label>
                <Input value={fLinha} onChange={(e) => setFLinha(e.target.value)} placeholder="Buscar..." className="h-8 text-xs" />
              </div>
              {visao === "importadas" && (
                <>
                  <div className="flex flex-col gap-1 min-w-[170px]">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Situação</label>
                    <Select value={fSit} onValueChange={(v) => setFSit(v as Situacao | "__all")}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all">Todas</SelectItem>
                        {ORDEM_SIT.map((s) => <SelectItem key={s} value={s}>{SIT[s].label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1 min-w-[160px]">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dia tipo</label>
                    <Select value={fDia} onValueChange={setFDia}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all">Todos</SelectItem>
                        {opcoesDia.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-end gap-2 text-xs cursor-pointer select-none pb-1">
                    <Checkbox checked={somenteAtivas} onCheckedChange={(v) => setSomenteAtivas(!!v)} />
                    Somente versões ativas
                  </label>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="p-0 overflow-x-auto">
              {visao === "importadas" ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Linha</TableHead>
                      <TableHead>Dia tipo</TableHead>
                      <TableHead>Projeto / Versão</TableHead>
                      <TableHead className="text-right">Nº versão</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Linha no Histórico</TableHead>
                      <TableHead>Dia tipo no Histórico</TableHead>
                      <TableHead>Referência</TableHead>
                      <TableHead>Vigência</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lista as LinhaConf[]).slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA).map((c) => (
                      <TableRow key={`${c.linha}||${c.diaTipo}||${c.versaoTexto}`}>
                        <TableCell className="font-medium">{c.linha}</TableCell>
                        <TableCell className="text-xs">{c.diaTipo || "—"}</TableCell>
                        <TableCell className="text-xs">
                          {c.versaoTexto}
                          {c.ativa && <Badge variant="outline" className="ml-2 text-[10px]">ativa</Badge>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{c.numero ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline" className={`text-[10px] ${SIT[c.situacao].className}`}>{SIT[c.situacao].label}</Badge></TableCell>
                        <TableCell className="text-xs">{c.registro?.linha ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.registro?.dia_tipo ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.registro?.referencia ?? "—"}</TableCell>
                        <TableCell className="text-xs">{fmtDate(c.registro?.vigencia) || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Linha</TableHead>
                      <TableHead>Dia tipo</TableHead>
                      <TableHead className="text-right">Nº versão</TableHead>
                      <TableHead>Referência</TableHead>
                      <TableHead>Vigência</TableHead>
                      <TableHead>Encerramento</TableHead>
                      <TableHead>Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lista as SoHistorico[]).slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA).map((s) => (
                      <TableRow key={s.h.id}>
                        <TableCell className="font-medium">{s.h.linha}</TableCell>
                        <TableCell className="text-xs">{s.h.dia_tipo ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.h.versao ?? "—"}</TableCell>
                        <TableCell className="text-xs">{s.h.referencia ?? "—"}</TableCell>
                        <TableCell className="text-xs">{fmtDate(s.h.vigencia) || "—"}</TableCell>
                        <TableCell className="text-xs">{fmtDate(s.h.encerramento) || "—"}</TableCell>
                        <TableCell className="text-xs">{s.motivo}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {lista.length === 0 && <div className="p-6 text-sm text-muted-foreground text-center">Nada com esses filtros.</div>}
            </CardContent>
          </Card>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-end gap-2 text-xs">
              <span className="text-muted-foreground">{lista.length.toLocaleString("pt-BR")} registro(s) · página {pag + 1} de {totalPaginas}</span>
              <Button variant="outline" size="sm" disabled={pag === 0} onClick={() => setPagina(pag - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={pag >= totalPaginas - 1} onClick={() => setPagina(pag + 1)}>Próxima</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
