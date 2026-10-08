import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllViagens } from "@/lib/viagens";
import { fetchLinhas, fetchEmpresaEstacao } from "@/lib/data";
import { fetchSiglasEstacao, buildSiglaMap, resolveSigla } from "@/lib/siglas-estacao";
import {
  buildEmpresaOverrideMap,
  resolveUnidadeViagem,
  resolveGrupoViagem,
  resolveEmpresaViagem,
} from "@/lib/empresa-estacao";
import {
  agruparBandas,
  fmtHHMM,
  parseHHMMToMin,
  normalizarVirada,
  calcularResumoLinha,
  type Banda,
} from "@/lib/quadro-horario";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Table2, FileSpreadsheet, FileText, Sparkles, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PDF_BLUE, PDF_LINE_BLUE, XLSX_BLUE } from "@/lib/report-style";
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
type SentidoResult = {
  partidas: number[];
  corrido: Corrido[];
  // Nome do ponto de origem por extenso (traduzido via cadastro de Siglas —
  // src/lib/siglas-estacao.ts). Cai pra sigla crua se não tiver tradução
  // cadastrada, nunca fica em branco.
  origemNome: string;
};
type LinhaResult = {
  linha: string;
  porSentido: Record<Sentido, SentidoResult>;
  versoesEncontradas: string[];
};
type Applied = {
  linha: string[];
  dia: string;
  versao: string;
  tipoServico: string;
  movimento: string;
  categoriaMovimento: string;
  categoriaLinha: string;
  unidade: string;
  grupo: string;
  empresa: string;
  corteVirada: string;
};
type BandaComOrigem = Banda & { sentido: Sentido; origemNome: string };

const CORTE_VIRADA_PADRAO = "03:00";

/** Valor mais frequente numa lista (ex.: sigla de origem entre as viagens
 *  de um sentido) — ignora vazios. Empate resolve pelo primeiro encontrado. */
function maisFrequente(valores: (string | null | undefined)[]): string {
  const tally = new Map<string, number>();
  for (const v of valores) {
    const s = (v ?? "").trim();
    if (!s) continue;
    tally.set(s, (tally.get(s) ?? 0) + 1);
  }
  let best = "";
  let bestN = -1;
  for (const [s, n] of tally) {
    if (n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return best;
}

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

const RESUMO_HEADER = ["Origem", "Dia da Semana", "Início", "Fim", "Intervalo (min)"];

// Um bloco por linha — título em negrito, cabeçalho azul repetido, linhas
// de banda, e uma linha em branco antes do próximo bloco. Antes, todas as
// linhas iam pra uma tabela única e contínua (um cabeçalho só lá em cima,
// tudo colado) — ficava difícil separar visualmente onde uma linha acaba e
// a próxima começa quando o quadro tinha várias linhas selecionadas.
function exportResumoXLSX(
  applied: Applied,
  resultados: LinhaResult[],
  bandasPorLinha: Map<string, BandaComOrigem[]>,
) {
  type RowKind = "title" | "header" | "body" | "blank";
  const rows: (string | number)[][] = [];
  const kinds: RowKind[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const totalCols = RESUMO_HEADER.length;

  for (const r of resultados) {
    const bandas = bandasPorLinha.get(r.linha) ?? [];
    if (bandas.length === 0) continue;
    rows.push([`Linha ${r.linha} — Quadro de Horário Simplificado`]);
    kinds.push("title");
    merges.push({ s: { r: rows.length - 1, c: 0 }, e: { r: rows.length - 1, c: totalCols - 1 } });
    rows.push([...RESUMO_HEADER]);
    kinds.push("header");
    for (const b of bandas) {
      rows.push([b.origemNome, applied.dia, fmtHHMM(b.inicio), fmtHHMM(b.fim), b.intervalo]);
      kinds.push("body");
    }
    rows.push([]);
    kinds.push("blank");
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = merges;
  ws["!cols"] = RESUMO_HEADER.map((_, i) => ({ wch: i === 0 || i === 1 ? 22 : 16 }));

  const FILL_BLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE } };
  rows.forEach((_, r) => {
    const kind = kinds[r];
    if (kind === "blank") return;
    for (let c = 0; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = (ws as any)[addr];
      if (!cell) continue;
      if (kind === "title") cell.s = { font: { bold: true, sz: 12, color: { rgb: XLSX_BLUE } } };
      else if (kind === "header") cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: FILL_BLUE, alignment: { horizontal: "center" } };
      else cell.s = { alignment: { horizontal: c === 0 ? "left" : "center" } };
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Quadro de Horário");
  XLSX.writeFile(wb, `quadro_horario_${applied.dia}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

const RESUMO_LINHA_HEADER = [
  "Linha",
  "1ª Saída",
  "Última Saída",
  "Intervalo Pico (min)",
  "Intervalo Fora Pico (min)",
  "Intervalo Médio (min)",
  "Frequência Média (partidas/h)",
];

function exportResumoLinhaXLSX(
  applied: Applied,
  resultados: LinhaResult[],
  resumosPorLinha: Map<string, ReturnType<typeof calcularResumoLinha>>,
) {
  const rows: (string | number)[][] = [RESUMO_LINHA_HEADER];
  for (const r of resultados) {
    const res = resumosPorLinha.get(r.linha);
    if (!res) continue;
    rows.push([
      r.linha,
      res.primeiraSaida == null ? "" : fmtHHMM(res.primeiraSaida),
      res.ultimaSaida == null ? "" : fmtHHMM(res.ultimaSaida),
      res.intervaloPico ?? "",
      res.intervaloForaPico ?? "",
      res.intervaloMedio ?? "",
      res.frequenciaMedia ?? "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = RESUMO_LINHA_HEADER.map((_, i) => ({ wch: i === 0 ? 10 : 18 }));
  const FILL_BLUE = { patternType: "solid", fgColor: { rgb: XLSX_BLUE } };
  for (let c = 0; c < RESUMO_LINHA_HEADER.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = (ws as any)[addr];
    if (cell) {
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: FILL_BLUE,
        alignment: { horizontal: "center" },
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resumo por Linha");
  XLSX.writeFile(
    wb,
    `quadro_horario_resumo_linha_${applied.dia}_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

// PDF: mesma ideia — um bloco (autoTable) por linha, nome em negrito,
// cabeçalho azul, espaço antes do próximo bloco. `didDrawPage` reaplica o
// título/subtítulo do relatório em toda página nova (quando um bloco não
// cabe inteiro numa página só).
function exportResumoPDF(
  applied: Applied,
  resultados: LinhaResult[],
  bandasPorLinha: Map<string, BandaComOrigem[]>,
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const titleTxt = "QUADRO DE HORÁRIO SIMPLIFICADO";
  const subtitleTxt = `${applied.dia} — Gerado em ${new Date().toLocaleString("pt-BR")}`;

  function drawHeader() {
    doc.setTextColor(...PDF_LINE_BLUE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(titleTxt, pageW / 2, 12, { align: "center" });
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.setFont("helvetica", "normal");
    doc.text(subtitleTxt, pageW / 2, 18, { align: "center" });
    doc.setDrawColor(...PDF_LINE_BLUE);
    doc.setLineWidth(0.5);
    doc.line(12, 21, pageW - 12, 21);
    doc.setTextColor(20);
  }

  drawHeader();
  let currentY = 26;

  for (const r of resultados) {
    const bandas = bandasPorLinha.get(r.linha) ?? [];
    if (bandas.length === 0) continue;
    const nameHeadRow = [
      {
        content: `Linha ${r.linha} — Quadro de Horário Simplificado`,
        colSpan: RESUMO_HEADER.length,
        styles: { halign: "left" as const, fontStyle: "bold" as const, fillColor: [255, 255, 255] as [number, number, number], textColor: PDF_LINE_BLUE, fontSize: 10 },
      },
    ];
    const realHeadRow = RESUMO_HEADER.map((label) => ({
      content: label,
      styles: { fillColor: PDF_BLUE, textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const, halign: "center" as const },
    }));
    autoTable(doc, {
      startY: currentY,
      head: [nameHeadRow, realHeadRow],
      body: bandas.map((b) => [b.origemNome, applied.dia, fmtHHMM(b.inicio), fmtHHMM(b.fim), `${b.intervalo} min`]),
      styles: { fontSize: 9, cellPadding: 1.6, valign: "middle", halign: "center", lineColor: [180, 180, 180], lineWidth: 0.18 },
      columnStyles: { 0: { halign: "left" } },
      margin: { left: 12, right: 12, top: 24, bottom: 12 },
      theme: "grid",
      pageBreak: "auto",
      didDrawPage: drawHeader,
    });
    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  doc.save(`quadro_horario_${applied.dia}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

function QuadroHorarioPage() {
  useAuditView("quadro_horario");
  const [fLinha, setFLinha] = usePersistentState<string[]>("quadro.fLinha", []);
  const [fDia, setFDia] = usePersistentState("quadro.fDia", "__all");
  const [fVersao, setFVersao] = usePersistentState("quadro.fVersao", "__all");
  const [fTipoServico, setFTipoServico] = usePersistentState("quadro.fTipoServico", "__all");
  const [fMovimento, setFMovimento] = usePersistentState("quadro.fMovimento", "Comercial");
  const [fCategoriaMovimento, setFCategoriaMovimento] = usePersistentState(
    "quadro.fCategoriaMovimento",
    "Viagem",
  );
  const [fCategoriaLinha, setFCategoriaLinha] = usePersistentState(
    "quadro.fCategoriaLinha",
    "__all",
  );
  const [fUnidade, setFUnidade] = usePersistentState("quadro.fUnidade", "__all");
  const [fGrupo, setFGrupo] = usePersistentState("quadro.fGrupo", "__all");
  const [fEmpresa, setFEmpresa] = usePersistentState("quadro.fEmpresa", "__all");
  const [fCorteVirada, setFCorteVirada] = usePersistentState(
    "quadro.fCorteVirada",
    CORTE_VIRADA_PADRAO,
  );
  const [tolerancia, setTolerancia] = usePersistentState("quadro.tolerancia", 5);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [gerarResumo, setGerarResumo] = useState(false);
  const [mostrarResumoLinha, setMostrarResumoLinha] = usePersistentState(
    "quadro.mostrarResumoLinha",
    false,
  );

  const viagensQ = useQuery({ queryKey: ["viagens-all"], queryFn: fetchAllViagens });
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const empresaEstacaoQ = useQuery({ queryKey: ["empresa-estacao"], queryFn: fetchEmpresaEstacao });
  const siglasQ = useQuery({ queryKey: ["siglas-estacao"], queryFn: fetchSiglasEstacao });
  const viagens = viagensQ.data ?? [];
  const linhas = linhasQ.data ?? [];
  const empresaEstacao = empresaEstacaoQ.data ?? [];
  const loading = viagensQ.isLoading;

  const linhaMap = useMemo(() => new Map(linhas.map((l) => [l.linha, l])), [linhas]);
  const empresaOverrideMap = useMemo(
    () => buildEmpresaOverrideMap(empresaEstacao),
    [empresaEstacao],
  );
  // Tradução sigla -> {descricao, local} (cadastro em /importacao, aba
  // "Siglas" do Cadastro Unificado). Não altera nem sobrescreve nada do que
  // foi importado — só lê pra exibir o nome por extenso no lugar da sigla
  // crua de viagens.origem/destino.
  const siglaMap = useMemo(() => buildSiglaMap(siglasQ.data ?? []), [siglasQ.data]);

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
      categoriaLinha: Array.from(
        new Set(linhas.map((l) => l.categoria).filter(Boolean) as string[]),
      ).sort(),
      grupo: Array.from(
        new Set([
          ...(linhas.map((l) => l.ordem).filter(Boolean) as string[]),
          ...(empresaEstacao.map((e) => e.grupo).filter(Boolean) as string[]),
        ]),
      ).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
      empresa: Array.from(
        new Set([
          ...(linhas.map((l) => l.empresa).filter(Boolean) as string[]),
          ...(empresaEstacao.map((e) => e.empresa).filter(Boolean) as string[]),
        ]),
      ).sort(),
    }),
    [viagens, linhas, empresaEstacao],
  );

  function aplicarFiltros() {
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
      categoriaMovimento: fCategoriaMovimento,
      categoriaLinha: fCategoriaLinha,
      unidade: fUnidade,
      grupo: fGrupo,
      empresa: fEmpresa,
      corteVirada: fCorteVirada,
    });
    setGerarResumo(false);
  }

  // Versão: NÃO exige projeto ativo (/versoes-ativas) — pode haver
  // programação real e válida que não foi marcada como ativa. Sem escolher
  // uma Versão específica, traz tudo que existir pra aquela linha+dia tipo;
  // se houver mais de uma versão distinta misturada, um aviso aparece no
  // card da linha (ver `versoesEncontradas` em `resultados`) pra decidir se
  // vale a pena escolher uma Versão manualmente.
  const viagensVersaoResolvida = useMemo(() => {
    if (!applied) return [];
    return applied.versao === "__all"
      ? viagens
      : viagens.filter((v) => v.versao_programacao === applied.versao);
  }, [viagens, applied]);

  // Partidas que valem pra horário de passageiro: só Movimento/Categoria
  // selecionados (padrão: Comercial + Viagem — exclui deslocamento/soltura/
  // recolha, que não são horário público) da linha+dia+versão escolhidos.
  // Linha é opcional: se nada for selecionado, entra qualquer linha que
  // bata com os outros filtros (Dia Tipo, Grupo, Unidade, Categoria da
  // Linha etc.) — não precisa escolher linha por linha.
  const filtered = useMemo(() => {
    if (!applied) return [];
    return viagensVersaoResolvida.filter(
      (v) =>
        (applied.linha.length === 0 || applied.linha.includes(v.linha)) &&
        v.tipo_operacao === applied.dia &&
        (applied.tipoServico === "__all" ||
          (v.tipo_servico ?? "").toUpperCase() === applied.tipoServico) &&
        (applied.movimento === "__all" || (v.tipo_movimento ?? "").trim() === applied.movimento) &&
        (applied.categoriaMovimento === "__all" ||
          (v.categoria_movimento ?? "").trim() === applied.categoriaMovimento) &&
        (applied.categoriaLinha === "__all" ||
          linhaMap.get(v.linha)?.categoria === applied.categoriaLinha) &&
        (applied.unidade === "__all" ||
          resolveUnidadeViagem(v, linhaMap, empresaOverrideMap) === applied.unidade) &&
        (applied.grupo === "__all" ||
          resolveGrupoViagem(v, linhaMap, empresaOverrideMap) === applied.grupo) &&
        (applied.empresa === "__all" ||
          resolveEmpresaViagem(v, linhaMap, empresaOverrideMap) === applied.empresa),
    );
  }, [viagensVersaoResolvida, applied, linhaMap, empresaOverrideMap]);

  const resultados = useMemo<LinhaResult[]>(() => {
    if (!applied) return [];
    const corteMin = parseHHMMToMin(applied.corteVirada) ?? parseHHMMToMin(CORTE_VIRADA_PADRAO)!;
    // Linhas-alvo: as selecionadas manualmente, ou — se nenhuma — todas as
    // que sobraram em `filtered` depois dos outros filtros.
    const linhasAlvo =
      applied.linha.length > 0
        ? applied.linha
        : Array.from(new Set(filtered.map((v) => v.linha))).sort();

    return linhasAlvo.map((linha) => {
      const porSentido = {} as Record<Sentido, SentidoResult>;
      for (const sentido of SENTIDOS) {
        const viagensSentido = filtered.filter(
          (v) => v.linha === linha && (v.sentido ?? "").trim() === sentido,
        );
        // Horários de madrugada (< corte, ex. 03:00) são "virada" da noite
        // anterior — empurrados +24h só pra ordenar/agrupar DEPOIS da noite,
        // nunca antes da manhã. fmtHHMM devolve a hora normal na exibição.
        const partidas = Array.from(
          new Set(
            viagensSentido
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
        // Sigla de origem mais frequente entre as viagens desse sentido (o
        // ponto costuma ser constante numa linha, mas usa maioria por
        // segurança) -> traduz pro nome por extenso via cadastro de Siglas.
        // Sem tradução cadastrada, mostra a sigla crua mesmo.
        const origemSigla = maisFrequente(viagensSentido.map((v) => v.origem));
        const origemNome = resolveSigla(siglaMap, origemSigla)?.descricao ?? origemSigla;
        porSentido[sentido] = { partidas, corrido, origemNome };
      }
      const versoesEncontradas = Array.from(
        new Set(
          filtered
            .filter((v) => v.linha === linha)
            .map((v) => v.versao_programacao)
            .filter((v): v is string => Boolean(v)),
        ),
      ).sort();
      return { linha, porSentido, versoesEncontradas };
    });
  }, [applied, filtered, siglaMap]);

  const bandasPorLinha = useMemo(() => {
    const m = new Map<string, BandaComOrigem[]>();
    if (!gerarResumo) return m;
    for (const r of resultados) {
      const ida: BandaComOrigem[] = agruparBandas(r.porSentido.Ida.partidas, tolerancia).map(
        (b) => ({ ...b, sentido: "Ida" as const, origemNome: r.porSentido.Ida.origemNome }),
      );
      const volta: BandaComOrigem[] = agruparBandas(r.porSentido.Volta.partidas, tolerancia).map(
        (b) => ({ ...b, sentido: "Volta" as const, origemNome: r.porSentido.Volta.origemNome }),
      );
      m.set(r.linha, [...ida, ...volta]);
    }
    return m;
  }, [gerarResumo, resultados, tolerancia]);

  // 1ª/última saída e intervalos de Pico/Fora Pico/Médio por linha — ficha
  // técnica resumida (mesmo formato de planilha enviado ao DETRO). Usa a
  // mesma Tolerância de agrupamento do Quadro Resumido; não depende de
  // "Gerar Quadro Resumido" estar ligado, funciona isolado.
  const resumosPorLinha = useMemo(() => {
    const m = new Map<string, ReturnType<typeof calcularResumoLinha>>();
    if (!mostrarResumoLinha) return m;
    for (const r of resultados) {
      m.set(
        r.linha,
        calcularResumoLinha(r.porSentido.Ida.partidas, r.porSentido.Volta.partidas, tolerancia),
      );
    }
    return m;
  }, [mostrarResumoLinha, resultados, tolerancia]);

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
            placeholder="Todas"
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
            label="Categoria Movimento"
            value={fCategoriaMovimento}
            onChange={setFCategoriaMovimento}
            options={["Deslocamento", "Viagem"]}
          />
          <FiltroSelect
            label="Categoria da Linha"
            value={fCategoriaLinha}
            onChange={setFCategoriaLinha}
            options={opts.categoriaLinha}
          />
          <FiltroSelect
            label="Unidade"
            value={fUnidade}
            onChange={setFUnidade}
            options={opts.unidade}
          />
          <FiltroSelect label="Grupo" value={fGrupo} onChange={setFGrupo} options={opts.grupo} />
          <FiltroSelect
            label="Empresa"
            value={fEmpresa}
            onChange={setFEmpresa}
            options={opts.empresa}
          />
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
            Padrão: só partidas Comerciais de Categoria Movimento "Viagem" contam como horário de
            passageiro. Linha é opcional — sem selecionar nenhuma, gera o quadro pra todas as linhas
            que baterem com Dia Tipo/Grupo/Empresa/Unidade/Categoria da Linha/Movimento escolhidos.
            Versão "Todas" não exige que o projeto esteja marcado como ativo — traz tudo que existir
            pra cada linha+dia tipo (não precisa passar por /versoes-ativas antes). Se houver mais
            de uma versão diferente misturada numa linha, um aviso aparece pra você escolher uma
            Versão específica. Partidas antes de {fCorteVirada || CORTE_VIRADA_PADRAO} são tratadas
            como virada da noite anterior e entram no fim da sequência, não no início.
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
                <CardTitle className="text-base">
                  <span>Linha {r.linha} — Horário Corrido</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  {applied.dia} · Versão {applied.versao === "__all" ? "Todas" : applied.versao}
                </CardDescription>
                {applied.versao === "__all" && r.versoesEncontradas.length > 1 && (
                  <Badge
                    variant="outline"
                    className="gap-1 ring-1 bg-warning/10 text-warning ring-warning/20 w-fit"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {r.versoesEncontradas.length} versões misturadas nessa linha:{" "}
                    {r.versoesEncontradas.join(", ")} — selecione uma Versão pra isolar
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-0">
                {SENTIDOS.map((sentido) => (
                  <div key={sentido}>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">
                      {r.porSentido[sentido].origemNome || "?"}
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
              <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none pb-2">
                <Checkbox
                  checked={mostrarResumoLinha}
                  onCheckedChange={(v) => setMostrarResumoLinha(!!v)}
                />
                1ª/Última Saída e Intervalos (Pico/Entrepico)
              </label>
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
              {gerarResumo && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    exportResumoPDF(applied, resultados, bandasPorLinha);
                    void logAudit({
                      action: "export",
                      entity: "quadro_horario",
                      details: {
                        format: "pdf",
                        linhas: applied.linha,
                        dia: applied.dia,
                        versao: applied.versao,
                      },
                    });
                  }}
                >
                  <FileText className="h-4 w-4 mr-1" /> PDF
                </Button>
              )}
              <p className="text-xs text-muted-foreground w-full md:w-auto md:ml-2">
                Agrupa partidas seguidas com intervalo parecido (dentro da tolerância) num único
                bloco. O fim de cada bloco é sempre um horário real programado — nunca projetado
                além da última partida da linha.
              </p>
            </CardContent>
          </Card>

          {mostrarResumoLinha && (
            <Card className="shadow-[var(--shadow-card)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>1ª/Última Saída e Intervalos por Linha</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      exportResumoLinhaXLSX(applied, resultados, resumosPorLinha);
                      void logAudit({
                        action: "export",
                        entity: "quadro_horario",
                        details: {
                          format: "xlsx",
                          relatorio: "resumo_linha",
                          linhas: applied.linha,
                          dia: applied.dia,
                          versao: applied.versao,
                        },
                      });
                    }}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
                  </Button>
                </CardTitle>
                <CardDescription className="text-xs">
                  Pico = menor intervalo (maior frequência); Fora Pico (entrepico) = próxima faixa
                  de frequência acima do pico; Médio = intervalo médio ao longo do dia inteiro;
                  Frequência Média = partidas por hora (60 ÷ Intervalo Médio). Calculado pelo
                  Sentido Ida — Última Saída olha os dois sentidos. Intervalos arredondados pra
                  cima.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-auto">
                  <Table className="text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Linha</TableHead>
                        <TableHead>1ª Saída</TableHead>
                        <TableHead>Última Saída</TableHead>
                        <TableHead className="text-right">Intervalo Pico</TableHead>
                        <TableHead className="text-right">Intervalo Fora Pico</TableHead>
                        <TableHead className="text-right">Intervalo Médio</TableHead>
                        <TableHead className="text-right">Frequência Média</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultados.map((r) => {
                        const res = resumosPorLinha.get(r.linha);
                        if (!res) return null;
                        return (
                          <TableRow key={`resumo-linha-${r.linha}`}>
                            <TableCell className="font-medium">{r.linha}</TableCell>
                            <TableCell className="tabular-nums">
                              {res.primeiraSaida == null ? "—" : fmtHHMM(res.primeiraSaida)}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {res.ultimaSaida == null ? "—" : fmtHHMM(res.ultimaSaida)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {res.intervaloPico == null ? "—" : `${res.intervaloPico} min`}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {res.intervaloForaPico == null ? "—" : `${res.intervaloForaPico} min`}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {res.intervaloMedio == null ? "—" : `${res.intervaloMedio} min`}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {res.frequenciaMedia == null ? "—" : `${res.frequenciaMedia}/h`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

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
                              <TableCell className="font-medium">{b.origemNome || "?"}</TableCell>
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
