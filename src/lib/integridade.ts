// Rotina de auditoria "pente fino" — varre os dados já importados procurando
// inconsistências que, se não corrigidas, distorcem os relatórios (KM,
// jornada, frota, partidas). Não altera nada, só diagnostica.

import type { ViagemLite } from "./resumo";
import type { Linha } from "./data";
import type { KmMaps } from "./km";
import { viagemKmResult } from "./km";
import { buildJornadas } from "./jornada";
import type { RealizadoDb } from "./viagens-realizado";
import type { Importacao } from "./data";

export type Severidade = "critico" | "atencao" | "info";

export type AlertaIntegridade = {
  id: string;
  categoria: string;
  severidade: Severidade;
  titulo: string;
  descricao: string;
  quantidade: number;
  amostra: string[]; // até 20 exemplos, texto pronto pra exibir
};

const SEVERIDADE_ORDEM: Record<Severidade, number> = { critico: 0, atencao: 1, info: 2 };

export function runVerificacaoIntegridade(args: {
  viagens: ViagemLite[];
  linhas: Linha[];
  kmMaps: KmMaps;
  importacoes: Importacao[];
  realizado?: RealizadoDb[];
}): AlertaIntegridade[] {
  const { viagens, linhas, kmMaps, importacoes, realizado } = args;
  const linhaMap = new Map(linhas.map((l) => [l.linha, l]));
  const alertas: AlertaIntegridade[] = [];
  const amostra = (items: string[]) => items.slice(0, 20);

  // 1) Viagens com linha não cadastrada
  {
    const linhasFaltando = new Map<string, number>();
    for (const v of viagens) {
      if (!linhaMap.has(v.linha)) linhasFaltando.set(v.linha, (linhasFaltando.get(v.linha) ?? 0) + 1);
    }
    const total = Array.from(linhasFaltando.values()).reduce((s, n) => s + n, 0);
    if (total > 0) {
      alertas.push({
        id: "linha_nao_cadastrada",
        categoria: "Cadastro",
        severidade: "critico",
        titulo: "Viagens de linha não cadastrada",
        descricao: "Essas viagens usam um código de linha que não existe no Cadastro de Linhas — não entram em nenhum relatório por Empresa/Unidade/Grupo, e o KM sempre vem zerado.",
        quantidade: total,
        amostra: amostra(Array.from(linhasFaltando, ([linha, n]) => `Linha "${linha}" — ${n} viagem(ns)`)),
      });
    }
  }

  // 2) Linhas cadastradas sem Empresa ou sem Unidade
  {
    const semDado = linhas.filter((l) => !l.empresa?.trim() || !l.unidade?.trim());
    if (semDado.length > 0) {
      alertas.push({
        id: "linha_sem_empresa_unidade",
        categoria: "Cadastro",
        severidade: "atencao",
        titulo: "Linhas sem Empresa ou Unidade no cadastro",
        descricao: "Essas linhas existem no cadastro, mas faltam campos — aparecem como \"Sem empresa\"/\"Sem unidade\" nos resumos gerenciais.",
        quantidade: semDado.length,
        amostra: amostra(semDado.map((l) => `Linha ${l.linha}${!l.empresa?.trim() ? " — sem empresa" : ""}${!l.unidade?.trim() ? " — sem unidade" : ""}`)),
      });
    }
  }

  // 3) Viagens comerciais sem serviço ou turno
  {
    const semServicoTurno = viagens.filter((v) =>
      (v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL" && (!v.servico?.trim() || !v.turno?.trim()),
    );
    if (semServicoTurno.length > 0) {
      alertas.push({
        id: "sem_servico_turno",
        categoria: "Importação",
        severidade: "critico",
        titulo: "Viagens comerciais sem Serviço ou Turno",
        descricao: "Sem esses dois campos preenchidos, a viagem não entra em nenhuma conta de Frota ou Jornada — geralmente é falha na leitura do arquivo de origem.",
        quantidade: semServicoTurno.length,
        amostra: amostra(semServicoTurno.map((v) => `Linha ${v.linha}, versão ${v.versao_programacao ?? "?"}, partida ${v.partida ?? "?"}`)),
      });
    }
  }

  // 4) Viagens comerciais sem horário de partida
  {
    const semPartida = viagens.filter((v) => (v.tipo_movimento ?? "").trim().toUpperCase() === "COMERCIAL" && !v.partida?.trim());
    if (semPartida.length > 0) {
      alertas.push({
        id: "sem_partida",
        categoria: "Importação",
        severidade: "critico",
        titulo: "Viagens comerciais sem horário de partida",
        descricao: "Essas viagens não são contadas em nenhum total de \"Partidas\" dos relatórios.",
        quantidade: semPartida.length,
        amostra: amostra(semPartida.map((v) => `Linha ${v.linha}, serviço ${v.servico ?? "?"}, versão ${v.versao_programacao ?? "?"}`)),
      });
    }
  }

  // 5) Viagens sem trecho de KM cadastrado
  {
    const semKm = new Map<string, number>();
    for (const v of viagens) {
      if (viagemKmResult(v, kmMaps).fonte === "sem_cadastro") {
        const key = `${v.linha} — ${v.origem ?? "?"} → ${v.destino ?? "?"}`;
        semKm.set(key, (semKm.get(key) ?? 0) + 1);
      }
    }
    const total = Array.from(semKm.values()).reduce((s, n) => s + n, 0);
    if (total > 0) {
      alertas.push({
        id: "sem_km",
        categoria: "Cadastro",
        severidade: "atencao",
        titulo: "Viagens com trecho sem KM cadastrado",
        descricao: "Essas viagens são contadas com 0 km no total de quilometragem, subestimando o resultado de todos os relatórios.",
        quantidade: total,
        amostra: amostra(Array.from(semKm, ([trecho, n]) => `${trecho} — ${n} viagem(ns)`)),
      });
    }
  }

  // 6) Jornadas incoerentes (TU incompleto / sem parâmetro de antecipação)
  {
    const jornadas = buildJornadas(viagens, linhas);
    const incompletas = jornadas.filter((j) => j.incompleto);
    const semParam = jornadas.filter((j) => j.semCadastroLinha);
    if (incompletas.length > 0) {
      alertas.push({
        id: "tu_incompleto",
        categoria: "Jornada",
        severidade: "atencao",
        titulo: "Serviços TU com par Ida/Volta incompleto",
        descricao: "Um TU precisa das duas pontas (ida e volta) pra jornada fechar certo — esses ficaram de fora do total de jornada.",
        quantidade: incompletas.length,
        amostra: amostra(incompletas.map((j) => `Linha ${j.linha}, serviço ${j.servico}, versão ${j.versao}`)),
      });
    }
    if (semParam.length > 0) {
      alertas.push({
        id: "jornada_sem_param",
        categoria: "Jornada",
        severidade: "atencao",
        titulo: "Jornadas sem parâmetro de antecipação/prestação",
        descricao: "A linha não tem esses minutos cadastrados — a jornada calculada fica sem esse acréscimo, ficando menor do que a real.",
        quantidade: semParam.length,
        amostra: amostra(semParam.map((j) => `Linha ${j.linha}, serviço ${j.servico}, versão ${j.versao}`)),
      });
    }
  }

  // 7) Importações com erro de leitura
  {
    const comErro = importacoes.filter((i) => i.registros_erro > 0);
    if (comErro.length > 0) {
      alertas.push({
        id: "importacao_com_erro",
        categoria: "Importação",
        severidade: "critico",
        titulo: "Importações recentes com erro de leitura",
        descricao: "Arquivos que tiveram linhas rejeitadas na hora de importar (EasyBus, GPS/Cittati, Realizado, CSV). Vale conferir se o arquivo de origem está no formato esperado.",
        quantidade: comErro.length,
        amostra: amostra(comErro.map((i) => `${i.tipo} — ${i.arquivo ?? "?"} — ${i.registros_erro} erro(s) — ${new Date(i.created_at).toLocaleDateString("pt-BR")}`)),
      });
    }
  }

  // 8) Realizado (Cittati): linha não cadastrada (se um período foi carregado)
  if (realizado && realizado.length > 0) {
    const linhasFaltando = new Map<string, number>();
    for (const r of realizado) {
      if (!linhaMap.has(r.linha)) linhasFaltando.set(r.linha, (linhasFaltando.get(r.linha) ?? 0) + 1);
    }
    const total = Array.from(linhasFaltando.values()).reduce((s, n) => s + n, 0);
    if (total > 0) {
      alertas.push({
        id: "realizado_linha_nao_cadastrada",
        categoria: "Realizado",
        severidade: "critico",
        titulo: "Realizado com linha não cadastrada",
        descricao: "No período carregado do relatório Previsto x Realizado, essas linhas não batem com nenhuma linha do cadastro.",
        quantidade: total,
        amostra: amostra(Array.from(linhasFaltando, ([linha, n]) => `Linha "${linha}" — ${n} viagem(ns)`)),
      });
    }
  }

  return alertas.sort((a, b) => SEVERIDADE_ORDEM[a.severidade] - SEVERIDADE_ORDEM[b.severidade] || b.quantidade - a.quantidade);
}
