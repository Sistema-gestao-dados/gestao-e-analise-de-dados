import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllViagens } from "@/lib/viagens";
import { buildServiceUnits } from "@/lib/resumo";
import { fetchLinhas, fetchEmpresaEstacao } from "@/lib/data";
import { fetchProjetosAtivos, filterViagensAtivas } from "@/lib/projeto-ativo";
import {
  buildEmpresaOverrideMap,
  resolveUnidadeViagem,
  resolveGrupoViagem,
} from "@/lib/empresa-estacao";
import {
  agruparBandas,
  fmtHHMM,
  parseHHMMToMin,
  normalizarVirada,
  type Banda,
} from "@/lib/quadro-horario";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MultiSelect } from "@/components/multi-select";
import { useAuditView } from "@/lib/use-audit-view";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { Table2, FileSpreadsheet, Sparkles } from "lucide-react";
import * as XLSX from "xlsx";
import { logAudit } from "@/lib/audit";
import { toast } from "sonner";

export const Route = createFileRoute("/quadro-horario")({
  head: () => ({
    meta: [
      { title: "Quadro de Horário — Gestão e Análise de Dados" },
      {
        name: "description",
        content:
          "Horário corrido e quadro de horário simplificado (DETRO) a partir das viagens importadas.",
      },
    ],
  }),
  component: QuadroHorarioPage,
});

type Sentido = "Ida" | "Volta";
const SENTIDOS: Sentido[] = ["Ida", "Volta"];

type Corrido = { min: number; hhmm: string; intervalo: number | null };
type SentidoResult = { partidas: number[]; corrido: Corrido[] };
type LinhaResult = { linha: string; frota: number; porSentido: Record<Sentido, SentidoResult> };
type Applied = {
  linha: string[];
  dia: string;
  versao: string;
  tipoServico: string;
  movimento: string;
  categoria: string;
  unidade: string;
  grupo: string;
  corteVirada: string;
};
type BandaComOrigem = Banda & { origemLabel: "IDA" | "VOLTA" };

const CORTE_VIRADA_PADRAO = "03:00";

function FiltroSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Todos",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function exportResumoXLSX(
  applied: Applied,
  resultados: LinhaResult[],
  bandasPorLinha: Map<string, BandaComOrigem[]>,
) {
  const rows: Record<string, string | number>[] = [];
  for (const r of resultados) {
    const bandas = bandasPorLinha.get(r.linha) ?? [];
    for (const b of bandas.filter((x) => x.origemLabel === "IDA")) {
      rows.push({
        Linha: r.linha,
        Frota: r.frota,
        Origem: "IDA",
        "Dia da Semana": applied.dia,
        Início: fmtHHMM(b.inicio),
        Fim: fmtHHMM(b.fim),
        "Intervalo (min)": b.intervalo,
      });
    }
    for (const b of bandas.filter((x) => x.origemLabel === "VOLTA")) {
      rows.push({
        Linha: r.linha,
        Frota: r.frota,
        Origem: "VOLTA",
        "Dia da Semana": applied.dia,
        Início: fmtHHMM(b.inicio),
        Fim: fmtHHMM(b.fim),
        "Intervalo (min)": b.intervalo,
      });
    }
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Quadro de Horário");
  XLSX.writeFile(wb, `quadro_horario_${applied.dia}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function QuadroHorarioPage() {
  useAuditView("quadro_horario");
  const [fLinha, setFLinha] = usePersistentState<string[]>("quadro.fLinha", []);
  const [fDia, setFDia] = usePersistentState("quadro.fDia", "__all");
  const [fVersao, setFVersao] = usePersistentState("quadro.fVersao", "__all");
  const [fTipoServico, setFTipoServico] = usePersistentState("quadro.fTipoServico", "__all");
  const [fMovimento, setFMovimento] = usePersistentState("quadro.fMovimento", "Comercial");
  const [fCategoria, setFCategoria] = usePersistentState("quadro.fCategoria", "Viagem");
  const [fUnidade, setFUnidade] = usePersistentState("quadro.fUnidade", "__all");
  const [fGrupo, setFGrupo] = usePersistentState("quadro.fGrupo", "__all");
  const [fCorteVirada, setFCorteVirada] = usePersistentState(
    "quadro.fCorteVirada",
    CORTE_VIRADA_PADRAO,
  );
  const [tolerancia, setTolerancia] = usePersistentState("quadro.tolerancia", 5);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [gerarResumo, setGerarResumo] = useState(false);

  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const empresaEstacaoQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  const ativosQ = useQuery({ queryKey: ["projetos-ativos"], queryFn: fetchProjetosAtivos });
  const viagens = viagensQ.data ?? [];
  const linhas = linhasQ.data ?? [];
  const empresaEstacao = empresaEstacaoQ.data ?? [];
  const ativos = ativosQ.data ?? [];
  const loading = viagensQ.isLoading;

  const linhaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l])), [linhas]);
  const empresaOverrideMap = useMemo(
    () => buildEmpresaOverrideMap(empresaEstacao),
    [empresaEstacao],
  );

  const opts = useMemo(
    () => ({
      linha: Array.from(new Set(viagens.map((v) => v.linha).filter(Boolean))).sort(),
      dia: Array.from(
        new Set(viagens.map((v) => v.tipo_operacao).filter(Boolean) as string[]),
      ).sort(),
      versao: Array.from(
        new Set(viagens.map((v) => v.versao_programacao).filter(Boolean) as string[]),
      ).sort(),
      unidade: Array.from(new Set(linhas.map((l) => l.unidade).filter(Boolean) as string[])).sort(),
      grupo: Array.from(
        new Set([
          ...(linhas.map((l) => l.ordem).filter(Boolean) as string[]),
          ...(empresaEstacao.map((e) => e.grupo).filter(Boolean) as string[]),
        ]),
      ).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
    }),
    [viagens, linhas, empresaEstacao],
  );

  function aplicarFiltros() {
    if (fLinha.length === 0) {
      toast.error("Selecione ao menos uma Linha");
      return;
    }
    if (fDia === "__all") {
      toast.error("Selecione o Dia Tipo");
      return;
    }
    setApplied({
      linha: fLinha,
      dia: fDia,
      versao: fVersao,
      tipoServico: fTipoServico,
      movimento: fMovimento,
      categoria: fCategoria,
      unidade: fUnidade,
      grupo: fGrupo,
      corteVirada: fCorteVirada,
    });
    setGerarResumo(false);
  }

  // Versão: se não foi escolhida manualmente, usa a versão ATIVA (projeto
  // vigente cadastrado em /versoes-ativas) de cada linha+dia tipo — não
  // obriga selecionar Versão toda vez que já existe um projeto ativo.
  // Combinação linha+dia sem projeto ativo nenhum simplesmente fica vazia
  // (mesma regra de filterViagensAtivas, usada em Jornada/Dashboard/etc.).
  const viagensVersaoResolvida = useMemo(() => {
    if (!applied) return [];
    return applied.versao === "__all"
      ? filterViagensAtivas(viagens, ativos)
      : viagens.filter((v) => v.versao_programacao === applied.versao);
  }, [viagens, ativos, applied]);

  // Partidas que valem pra horário de passageiro: só Movimento/Categoria
  // selecionados (padrão: Comercial + Viagem — exclui deslocamento/soltura/
  // recolha, que não são horário público) da linha+dia+versão escolhidos.
  const filtered = useMemo(() => {
    if (!applied) return [];
    return viagensVersaoResolvida.filter(
      (v) =>
        applied.linha.includes(v.linha) &&
        v.tipo_operacao === applied.dia &&
        (applied.tipoServico === "__all" ||
          (v.tipo_servico ?? "").toUpperCase() === applied.tipoServico) &&
        (applied.movimento === "__all" || (v.tipo_movimento ?? "").trim() === applied.movimento) &&
        (applied.categoria === "__all" ||
          (v.categoria_movimento ?? "").trim() === applied.categoria) &&
        (applied.unidade === "__all" ||
          resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) === applied.unidade) &&
        (applied.grupo === "__all" ||
          resolveGrupoViagem(v, linhaMap, empresaOverrideMap) === applied.grupo),
    );
  }, [viagensVersaoResolvida, applied, linhaMap, empresaOverrideMap]);

  const resultados = useMemo<LinhaResult[]>(() => {
    if (!applied) return [];
    const corteMin = parseHHMMToMin(applied.corteVirada) ?? parseHHMMToMin(CORTE_VIRADA_PADRAO)!;
    // Frota: veículo físico (vehicleKey) que atende essa linha nesse dia+versão,
    // reaproveitando a mesma lógica já validada de Resumo por Linha/Jornada —
    // sem filtrar por movimento/categoria aqui, pra não perder veículo que só
    // aparece em deslocamento noutro trecho da mesma linha.
    const viagensDiaVersao = viagensVersaoResolvida.filter(
      (v) =>
        v.tipo_operacao === applied.dia &&
        (applied.tipoServico === "__all" ||
          (v.tipo_servico ?? "").toUpperCase() === applied.tipoServico) &&
        (applied.unidade === "__all" ||
          resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) === applied.unidade) &&
        (applied.grupo === "__all" ||
          resolveGrupoViagem(v, linhaMap, empresaOverrideMap) === applied.grupo),
    );
    const units = buildServiceUnits(viagensDiaVersao, () => 0);
    const unitsArr = Array.from(units.values());

    return applied.linha.map((linha) => {
      const frota = new Set(
        unitsArr.filter((u) => u.viagensPorLinha.has(linha)).map((u) => u.vehicleKey),
      ).size;
      const porSentido = {} as Record<Sentido, SentidoResult>;
      for (const sentido of SENTIDOS) {
        // Horários de madrugada (< corte, ex. 03:00) são "virada" da noite
        // anterior — empurrados +24h só pra ordenar/agrupar DEPOIS da noite,
        // nunca antes da manhã. fmtHHMM devolve a hora normal na exibição.
        const partidas = Array.from(
          new Set(
            filtered
              .filter((v) => v.linha === linha && (v.sentido ?? "").trim() === sentido)
              .map((v) => parseHHMMToMin(v.partida))
              .filter((m): m is number => m != null)
              .map((m) => normalizarVirada(m, corteMin)),
          ),
        ).sort((a, b) => a - b);
        const corrido: Corrido[] = partidas.map((m, i) => ({
          min: m,
          hhmm: fmtHHMM(m),
          intervalo: i === 0 ? null : m - partidas[i - 1],
        }));
        porSentido[sentido] = { partidas, corrido };
      }
      return { linha, frota, porSentido };
    });
  }, [applied, filtered, viagensVersaoResolvida, linhaMap, empresaOverrideMap]);

  const bandasPorLinha = useMemo(() => {
    const m = new Map<string, BandaComOrigem[]>();
    if (!gerarResumo) return m;
    for (const r of resultados) {
      const ida: BandaComOrigem[] = agruparBandas(r.porSentido.Ida.partidas, tolerancia).map(
        (b) => ({ ...b, origemLabel: "IDA" }),
      );
      const volta: BandaComOrigem[] = agruparBandas(r.porSentido.Volta.partidas, tolerancia).map(
        (b) => ({ ...b, origemLabel: "VOLTA" }),
      );
      m.set(r.linha, [...ida, ...volta]);
    }
    return m;
  }, [gerarResumo, resultados, tolerancia]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Table2 className="h-6 w-6 text-primary" /> Quadro de Horário
        </h1>
        <p className="text-sm text-muted-foreground">
          Horário corrido (partidas em ordem, com o intervalo até a próxima) e o quadro de horário
          simplificado agrupado em bandas de cadência parecida — formato usado no envio ao DETRO.
        </p>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <MultiSelect
            label="Linha"
            values={fLinha}
            onChange={setFLinha}
            options={opts.linha}
            className="w-56"
          />
          <FiltroSelect
            label="Dia Tipo"
            value={fDia}
            onChange={setFDia}
            options={opts.dia}
            placeholder="Selecione"
          />
          <FiltroSelect
            label="Versão"
            value={fVersao}
            onChange={setFVersao}
            options={opts.versao}
            placeholder="Todas (projeto ativo)"
          />
          <FiltroSelect
            label="Tipo Serv."
            value={fTipoServico}
            onChange={setFTipoServico}
            options={["TU", "DIR"]}
          />
          <FiltroSelect
            label="Movimento"
            value={fMovimento}
            onChange={setFMovimento}
            options={["Soltura", "Comercial", "Recolha", "Deslocamento"]}
          />
          <FiltroSelect
            label="Categoria"
            value={fCategoria}
            onChange={setFCategoria}
            options={["Deslocamento", "Viagem"]}
          />
          <FiltroSelect
            label="Unidade"
            value={fUnidade}
            onChange={setFUnidade}
            options={opts.unidade}
          />
          <FiltroSelect label="Grupo" value={fGrupo} onChange={setFGrupo} options={opts.grupo} />
          <div>
            <label className="text-xs text-muted-foreground">Corte da virada (madrugada)</label>
            <Input
              type="time"
              className="w-28"
              value={fCorteVirada}
              onChange={(e) => setFCorteVirada(e.target.value || CORTE_VIRADA_PADRAO)}
            />
          </div>
          <Button size="sm" onClick={aplicarFiltros} disabled={loading}>
            Consultar
          </Button>
          <p className="text-xs text-muted-foreground w-full">
            Padrão: só partidas Comerciais de Categoria "Viagem" contam como horário de passageiro.
            Versão "Todas" usa automaticamente o projeto ativo (versão vigente) de cada linha+dia
            tipo — só escolha uma Versão específica se quiser ver uma versão fora de vigência.
            Partidas antes de {fCorteVirada || CORTE_VIRADA_PADRAO} são tratadas como virada da
            noite anterior e entram no fim da sequência, não no início.
          </p>
        </CardContent>
      </Card>

      {!applied ? null : loading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Carregando...
          </CardContent>
        </Card>
      ) : resultados.every(
          (r) => r.porSentido.Ida.partidas.length === 0 && r.porSentido.Volta.partidas.length === 0,
        ) ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma partida comercial encontrada com esses filtros.
          </CardContent>
        </Card>
      ) : (
        <>
          {resultados.map((r) => (
            <Card key={r.linha} className="shadow-[var(--shadow-card)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Linha {r.linha} — Horário Corrido</span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    FROTA: {r.frota}
                  </span>
                </CardTitle>
                <CardDescription className="text-xs">
                  {applied.dia} · Versão {applied.versao}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-0">
                {SENTIDOS.map((sentido) => (
                  <div key={sentido}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      {sentido === "Ida" ? "IDA" : "VOLTA"}
                    </p>
                    {r.porSentido[sentido].corrido.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sem partidas.</p>
                    ) : (
                      <div className="overflow-auto max-h-72 border rounded-md">
                        <Table className="text-xs">
                          <TableHeader>
                            <TableRow className="h-8">
                              <TableHead className="px-2 py-1">Partida</TableHead>
                              <TableHead className="px-2 py-1 text-right">Intervalo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {r.porSentido[sentido].corrido.map((c) => (
                              <TableRow key={c.min} className="h-7">
                                <TableCell className="px-2 py-1 tabular-nums">{c.hhmm}</TableCell>
                                <TableCell className="px-2 py-1 text-right tabular-nums">
                                  {c.intervalo == null ? "—" : `${c.intervalo} min`}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="p-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-muted-foreground">
                  Tolerância de agrupamento (min)
                </label>
                <Input
                  type="number"
                  min={0}
                  className="w-28"
                  value={tolerancia}
                  onChange={(e) => setTolerancia(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <Button size="sm" onClick={() => setGerarResumo(true)}>
                <Sparkles className="h-4 w-4 mr-1" /> Gerar Quadro Resumido
              </Button>
              {gerarResumo && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    exportResumoXLSX(applied, resultados, bandasPorLinha);
                    void logAudit({
                      action: "export",
                      entity: "quadro_horario",
                      details: {
                        format: "xlsx",
                        linhas: applied.linha,
                        dia: applied.dia,
                        versao: applied.versao,
                      },
                    });
                  }}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
                </Button>
              )}
              <p className="text-xs text-muted-foreground w-full md:w-auto md:ml-2">
                Agrupa partidas seguidas com intervalo parecido (dentro da tolerância) num único
                bloco. O fim de cada bloco é sempre um horário real programado — nunca projetado
                além da última partida da linha.
              </p>
            </CardContent>
          </Card>

          {gerarResumo &&
            resultados.map((r) => {
              const bandas = bandasPorLinha.get(r.linha) ?? [];
              if (bandas.length === 0) return null;
              return (
                <Card key={`resumo-${r.linha}`} className="shadow-[var(--shadow-card)]">
                  <CardHeader className="pb-2 text-center">
                    <CardTitle className="text-base">
                      Linha {r.linha} — Quadro de Horário Simplificado
                    </CardTitle>
                    <p className="text-sm font-bold">FROTA: {r.frota}</p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="overflow-auto">
                      <Table className="text-sm">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Origem</TableHead>
                            <TableHead>Dia da Semana</TableHead>
                            <TableHead>Início</TableHead>
                            <TableHead>Fim</TableHead>
                            <TableHead className="text-right">Intervalo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bandas.map((b, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{b.origemLabel}</TableCell>
                              <TableCell>{applied.dia}</TableCell>
                              <TableCell className="tabular-nums">{fmtHHMM(b.inicio)}</TableCell>
                              <TableCell className="tabular-nums">{fmtHHMM(b.fim)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {b.intervalo} min
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </>
      )}
    </div>
  );
}
