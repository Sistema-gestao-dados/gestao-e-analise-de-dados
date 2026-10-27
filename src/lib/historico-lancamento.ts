// "Lançar no Histórico" a partir do Relatório Comparativo (Atual × Proposta):
// monta, por linha (ou por Grupo de Linha), o texto de Alteração do
// Histórico de Reprogramação com o que mudou da Atual pra Proposta — ex.:
// "Redução de 2 carros e 40 partidas; aumento de 3 serviços. Programado: 30
// carros, 246 partidas e 46 serviços." O usuário escolhe quais números
// entram e pode editar tudo antes de gravar (ver
// src/components/lancar-historico-dialog.tsx).

import type { AggRow } from "@/lib/resumo";
import { fmtKm } from "@/lib/km";
import { fmtDur } from "@/lib/jornada";
import { fmtMoeda } from "@/lib/custo";

export type LinhaLancamento = {
  linha: string;
  /** Números da Atual / Proposta (null = linha não existe naquele lado). */
  a: AggRow | null;
  p: AggRow | null;
  custoA: number;
  custoP: number;
  /** Dia tipo e texto "Projeto / Versão" da Proposta nessa linha. */
  diaTipo: string;
  versaoTexto: string;
  /** Grupo de Linha (Cadastro de Grupos) no dia tipo — null = sem grupo. */
  grupo: string | null;
  /** Linha sem dado na Proposta, repetida da Atual pelo Comparativo. */
  repetida: boolean;
};

export type OpcoesTexto = {
  /** Carros e Serviços (= motoristas): não incluir, total, ou por turno —
   *  por turno = as mesmas colunas dos relatórios (Dir 1º T., Dir 2º T.,
   *  Aproveit., TU). Carros total = Frota. */
  carros: "nao" | "total" | "turno";
  servicos: "nao" | "total" | "turno";
  partidas: boolean;
  km: boolean;
  he: boolean;
  custo: boolean;
  /** Acrescenta "Programado: ..." com os números da Proposta. */
  programado: boolean;
};

export const OPCOES_PADRAO: OpcoesTexto = {
  carros: "total", servicos: "total", partidas: true, km: false, he: false, custo: false, programado: true,
};

/** "a", "a e b", "a, b e c". */
function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${Math.abs(n) === 1 ? um : varios}`;

type Metrica = {
  /** Valor de um lado (Atual ou Proposta). */
  valor: (r: AggRow | null, custo: number) => number;
  /** Quantidade já com a unidade (sempre positiva). */
  fmt: (n: number) => string;
  arred: (n: number) => number;
  /** Entra no "Programado:" (hora extra e custo ficam só na diferença,
   *  pra não virar textão). */
  noProgramado: boolean;
};

const INT = (n: number) => Math.round(n);

function metricas(o: OpcoesTexto): Metrica[] {
  const out: Metrica[] = [];
  // Por turno: uma métrica por coluna do relatório (Dir 1º T., Dir 2º T.,
  // Aproveit., TU) — "2 carros no 1º turno", "3 serviços TU"...
  const porTurno = (um: string, varios: string) => {
    const col: [keyof AggRow, string][] = [["dir1", "no 1º turno"], ["dir2", "no 2º turno"], ["aprov", "no aproveitamento"], ["tu", "TU"]];
    for (const [k, sufixo] of col) {
      out.push({ valor: (r) => Number(r?.[k] ?? 0), fmt: (n) => `${plural(n, um, varios)} ${sufixo}`, arred: INT, noProgramado: true });
    }
  };
  if (o.carros === "total") out.push({ valor: (r) => r?.frota ?? 0, fmt: (n) => plural(n, "carro", "carros"), arred: INT, noProgramado: true });
  if (o.carros === "turno") porTurno("carro", "carros");
  if (o.servicos === "total") out.push({ valor: (r) => r?.totalServico ?? 0, fmt: (n) => plural(n, "serviço", "serviços"), arred: INT, noProgramado: true });
  if (o.servicos === "turno") porTurno("serviço", "serviços");
  if (o.partidas) out.push({ valor: (r) => r?.partidas ?? 0, fmt: (n) => plural(n, "partida", "partidas"), arred: INT, noProgramado: true });
  if (o.km) out.push({ valor: (r) => r?.km ?? 0, fmt: (n) => `${fmtKm(n)} km`, arred: (n) => Math.round(n * 10) / 10, noProgramado: true });
  if (o.he) out.push({ valor: (r) => r?.heMin ?? 0, fmt: (n) => `${fmtDur(n)} de hora extra`, arred: INT, noProgramado: false });
  if (o.custo) out.push({ valor: (_r, c) => c, fmt: (n) => `${fmtMoeda(n)} de custo de mão de obra`, arred: (n) => Math.round(n * 100) / 100, noProgramado: false });
  return out;
}

/** Texto de alteração de UMA linha (sem o nome da linha na frente). */
export function textoAlteracaoLinha(l: LinhaLancamento, o: OpcoesTexto): string {
  const ms = metricas(o);
  const programado = () => {
    if (!o.programado || !l.p) return "";
    const itens = ms
      .filter((m) => m.noProgramado)
      .map((m) => m.arred(m.valor(l.p, l.custoP)) && m.fmt(m.arred(m.valor(l.p, l.custoP))))
      .filter((s): s is string => !!s);
    return itens.length ? ` Programado: ${juntar(itens)}.` : "";
  };
  if (!l.a && l.p) return `Linha incluída no projeto.${programado()}`;
  if (l.a && !l.p) return "Linha retirada do projeto.";

  const reducoes: string[] = [];
  const aumentos: string[] = [];
  for (const m of ms) {
    const d = m.arred(m.arred(m.valor(l.p, l.custoP)) - m.arred(m.valor(l.a, l.custoA)));
    if (d < 0) reducoes.push(m.fmt(-d));
    else if (d > 0) aumentos.push(m.fmt(d));
  }
  if (!reducoes.length && !aumentos.length) return `Sem alteração.${programado()}`;
  const partes: string[] = [];
  if (reducoes.length) partes.push(`Redução de ${juntar(reducoes)}`);
  if (aumentos.length) partes.push(`${partes.length ? "aumento" : "Aumento"} de ${juntar(aumentos)}`);
  return `${partes.join("; ")}.${programado()}`;
}

export type Registro = {
  /** Chave estável do registro (linha, ou "grupo:<nome>"). */
  chave: string;
  /** Linha gravada no Histórico (no modo grupo, a 1ª linha do grupo). */
  linha: string;
  linhas: LinhaLancamento[];
  diaTipo: string;
  versaoTexto: string;
  /** Texto gerado (sem a descrição geral). */
  texto: string;
};

const cmpLinha = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

/** Um registro por linha, ou um por Grupo de Linha (texto com um item por
 *  linha, igual ao que já se lançava à mão: "• 01: ...", "• 01A: ..."). */
export function montarRegistros(linhas: LinhaLancamento[], o: OpcoesTexto, modo: "linha" | "grupo"): Registro[] {
  if (modo === "linha") {
    return linhas.map((l) => ({
      chave: l.linha, linha: l.linha, linhas: [l], diaTipo: l.diaTipo, versaoTexto: l.versaoTexto,
      texto: textoAlteracaoLinha(l, o),
    }));
  }
  const grupos = new Map<string, LinhaLancamento[]>();
  for (const l of linhas) {
    const k = l.grupo ? `grupo:${l.grupo}` : l.linha;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(l);
  }
  return Array.from(grupos, ([chave, ls]) => {
    const ord = [...ls].sort((x, y) => cmpLinha(x.linha, y.linha));
    // Dia tipo/versão da 1ª linha que está de fato na Proposta.
    const ref = ord.find((l) => l.p && !l.repetida) ?? ord[0];
    const texto = ord.length === 1
      ? textoAlteracaoLinha(ord[0], o)
      : ord.map((l) => `• ${l.linha}: ${textoAlteracaoLinha(l, o)}`).join("\n");
    return { chave, linha: ord[0].linha, linhas: ord, diaTipo: ref.diaTipo, versaoTexto: ref.versaoTexto, texto };
  });
}

/** Texto final gravado em `alteracao`: descrição geral + texto da linha. */
export function textoFinal(descricao: string, texto: string): string {
  const d = descricao.trim();
  return d ? `${d}\n\n${texto}` : texto;
}
