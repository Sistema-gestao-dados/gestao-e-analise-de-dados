// Parser para arquivos TXT do EasyBus (layout de largura fixa).
// Baseado no arquivo de exemplo "EASYBUS_ESCALA_..." fornecido pelo usuário.
//
// Faixas de caractere (0-indexadas, validadas contra o arquivo real):
//   [20:25)  Serviço/turno combinado (ex.: "02.1" = serviço 02, turno 1)
//   [25:33)  Linha
//   [44:50)  Sentido (Ida/Volta)
//   [50:56)  Partida (HH:MM)
//   [56:62)  Chegada (HH:MM)
//   [62:69)  Origem
//   [69:76)  Destino
//   [86:97)  Tipo de viagem (Viagem / Deslocamen / Intra-jorn)
//
// O arquivo tem um campo de observação de tamanho VARIÁVEL entre a coluna
// de tipo de viagem e o fim da linha (ex.: "DETRO- NÃO ALTERAR", "Peg 2º
// turno") — por isso o parser usa faixas de caractere fixas em vez de
// separar por espaços, que ficaria inconsistente nessas linhas.
//
// "Tipo Serv." (TU/DIR) não vem pronto no arquivo: é deduzido por
// versão+serviço+turno — NÃO por linha, porque o mesmo serviço pode trocar
// de linha no meio do dia (ex.: serviço 11.1 começa na 489M, passa pela
// 480M na intra-jornada, e volta pra 489M à tarde — é tudo o MESMO
// serviço). Se QUALQUER viagem desse serviço/turno tiver "Intra-jorn" na
// coluna de tipo de viagem, o serviço inteiro (em todas as linhas por
// onde ele passar) é classificado como "TU"; caso contrário, "DIR".
// Essa é a mesma regra usada no FLITS — muda só o formato do arquivo lido.
//
// Turno em grupos TU: o EasyBus só traz UM número de turno mesmo quando
// há um intervalo de intra-jornada no meio (ex.: manhã / descanso / tarde).
// Isso distorce o cálculo de jornada se tudo ficar como turno 1. Por isso,
// dentro de um grupo TU, as viagens são ordenadas por horário de partida e
// o número do turno é incrementado a cada "Intra-jorn" encontrado — ou
// seja, tudo antes do intervalo fica turno 1, tudo depois vira turno 2
// (e assim por diante, se houver mais de um intervalo).
//
// A própria viagem de "Intra-jorn" NÃO é gravada como viagem — ela não
// representa um deslocamento real, só marca o intervalo de descanso do
// motorista, então só serve para decidir a virada de turno acima.
//
// "Movimento" e "Categoria" vêm da mesma coluna de tipo de viagem:
//   Viagem      -> Movimento: Comercial   | Categoria: Viagem
//   Deslocamen  -> Movimento: Deslocamento| Categoria: Deslocamento
// (Categoria só tem 2 valores possíveis no cadastro.)
//
// "Tipo Op." (Dias Úteis/Sábado/Domingo, ou um dia tipo novo tipo feriado)
// não existe neste layout — é escolhido pelo usuário na tela antes de
// importar e aplicado a todas as linhas do arquivo.
//
// "Versão" é o texto entre parênteses no NOME do arquivo, ex.:
// "EASYBUS_ESCALA (MB22 757MU 120826V32) 10-08-2026 13-52-29.txt"
// -> versão = "MB22 757MU 120826V32"

import { fmtHora, tempoViagem } from "./txt-import";
import type { ViagemParsed, ParseResult } from "./txt-import";

function extrairVersaoDoNomeArquivo(nome: string): string | null {
  // Formato 1 (arquivo renomeado manualmente): "EASYBUS_ESCALA (U550M 01092026 V34) ...txt"
  const comParenteses = nome.match(/\(([^)]+)\)/);
  if (comParenteses) return comParenteses[1].trim();

  // Formato 2 (nome original, como vem do EasyBus, sem parênteses):
  // "EASYBUS_ESCALA__U550M_01092026_V34__28-08-2026_14-39-33.txt"
  // -> pega o trecho entre o 2º e o 3º par de underscores duplos e troca "_" por " ".
  const semParenteses = nome.match(/^EASYBUS_ESCALA__(.+?)__\d{2}-\d{2}-\d{4}/i);
  if (semParenteses) return semParenteses[1].replace(/_/g, " ").trim();

  return null;
}

function mapMovimento(tipoViagemRaw: string): { movimento: string | null; categoria: string | null } {
  const v = tipoViagemRaw.toLowerCase();
  if (v.startsWith("viagem")) return { movimento: "Comercial", categoria: "Viagem" };
  if (v.startsWith("desloc")) return { movimento: "Deslocamento", categoria: "Deslocamento" };
  return { movimento: null, categoria: null };
}

function minutos(hhmm: string | null): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

type Bruto = ViagemParsed & { _grupo: string; _intraJorn: boolean };

export function parseTxtEasyBus(
  content: string,
  arquivoNome = "",
  tipoOperacao: string | null = null,
): ParseResult {
  const lines = content.split(/\r?\n/);
  const errors: { line: number; reason: string }[] = [];
  const versao_programacao = extrairVersaoDoNomeArquivo(arquivoNome);
  const brutos: Bruto[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    try {
      const servicoTurno = raw.slice(20, 25).trim();
      const linha = raw.slice(25, 33).trim();
      const sentidoRaw = raw.slice(44, 50).trim();
      const partida = fmtHora(raw.slice(50, 56));
      const chegada = fmtHora(raw.slice(56, 62));
      const origem = raw.slice(62, 69).trim() || null;
      const destino = raw.slice(69, 76).trim() || null;
      const tipoViagemRaw = raw.slice(86, 97).trim();

      if (!linha) { errors.push({ line: i + 1, reason: "Linha vazia (coluna 26)" }); continue; }
      if (!servicoTurno) { errors.push({ line: i + 1, reason: "Serviço/turno vazio (coluna 21)" }); continue; }
      if (!partida) errors.push({ line: i + 1, reason: `Partida não reconhecida (bruto: "${raw.slice(50, 56)}")` });
      if (!chegada) errors.push({ line: i + 1, reason: `Chegada não reconhecida (bruto: "${raw.slice(56, 62)}")` });

      const [servicoRaw, turnoRaw] = servicoTurno.split(".");
      const servico = servicoRaw?.trim() || null;
      const turno = turnoRaw?.trim() || null;
      const sentido = sentidoRaw || null;
      const grupo = `${versao_programacao ?? ""}|${servico ?? ""}|${turno ?? ""}`;
      const intraJorn = tipoViagemRaw.toLowerCase().startsWith("intra");
      const { movimento, categoria } = mapMovimento(tipoViagemRaw);

      brutos.push({
        linha,
        tipo_operacao: tipoOperacao,
        versao_programacao,
        tipo_servico: null,
        servico,
        turno,
        origem,
        destino,
        tipo_movimento: movimento,
        categoria_movimento: categoria,
        sentido,
        partida,
        chegada,
        tempo_viagem: tempoViagem(partida, chegada),
        _grupo: grupo,
        _intraJorn: intraJorn,
      });
    } catch (e: any) {
      errors.push({ line: i + 1, reason: e?.message ?? "Erro desconhecido" });
    }
  }

  // Agrupa por versão+serviço+turno (NÃO por linha — ver comentário acima)
  const porGrupo = new Map<string, Bruto[]>();
  for (const b of brutos) {
    const arr = porGrupo.get(b._grupo) ?? [];
    arr.push(b);
    porGrupo.set(b._grupo, arr);
  }

  const rows: ViagemParsed[] = [];
  for (const itens of porGrupo.values()) {
    const isTU = itens.some((b) => b._intraJorn);

    if (!isTU) {
      for (const b of itens) {
        const { _grupo, _intraJorn, ...rest } = b;
        rows.push({ ...rest, tipo_servico: "DIR" });
      }
      continue;
    }

    // Grupo TU: ordena por horário e incrementa o turno a cada intervalo
    // de intra-jornada. A viagem de intra-jornada em si não é gravada.
    const ordenado = [...itens].sort((a, b) => minutos(a.partida) - minutos(b.partida));
    let turnoAtual = Number(ordenado[0]?.turno) || 1;
    for (const b of ordenado) {
      if (b._intraJorn) { turnoAtual += 1; continue; }
      const { _grupo, _intraJorn, ...rest } = b;
      rows.push({ ...rest, tipo_servico: "TU", turno: String(turnoAtual) });
    }
  }

  return { rows, errors };
}
