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
// "Tipo Serv." (TU/DIR) não vem pronto no arquivo: é deduzido por grupo
// linha+serviço+turno. Se QUALQUER viagem desse grupo tiver "Intra-jorn"
// na coluna de tipo de viagem, o grupo inteiro é classificado como "TU";
// caso contrário, "DIR".
//
// "Movimento" e "Categoria" vêm da mesma coluna de tipo de viagem:
//   Viagem      -> Movimento: Comercial   | Categoria: Viagem
//   Deslocamen  -> Movimento: Deslocamento| Categoria: Deslocamento
//   Intra-jorn  -> Movimento: Intra       | Categoria: Deslocamento
// (Categoria só tem 2 valores possíveis no cadastro — Intra-jornada entra
// como Deslocamento porque não é viagem comercial. Se preferir diferente,
// é só avisar.)
//
// "Tipo Op." (Dias Úteis/Sábado/Domingo) não existe neste layout — é
// escolhido pelo usuário na tela antes de importar e aplicado a todas as
// linhas do arquivo.
//
// "Versão" é o texto entre parênteses no NOME do arquivo, ex.:
// "EASYBUS_ESCALA (MB22 757MU 120826V32) 10-08-2026 13-52-29.txt"
// -> versão = "MB22 757MU 120826V32"

import { fmtHora, tempoViagem } from "./txt-import";
import type { ViagemParsed, ParseResult } from "./txt-import";

function extrairVersaoDoNomeArquivo(nome: string): string | null {
  const m = nome.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : null;
}

function mapMovimento(tipoViagemRaw: string): { movimento: string | null; categoria: string | null } {
  const v = tipoViagemRaw.toLowerCase();
  if (v.startsWith("viagem")) return { movimento: "Comercial", categoria: "Viagem" };
  if (v.startsWith("desloc")) return { movimento: "Deslocamento", categoria: "Deslocamento" };
  if (v.startsWith("intra")) return { movimento: "Intra", categoria: "Deslocamento" };
  return { movimento: null, categoria: null };
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

      const [servicoRaw, turnoRaw] = servicoTurno.split(".");
      const servico = servicoRaw?.trim() || null;
      const turno = turnoRaw?.trim() || null;
      const sentido = sentidoRaw || null;
      const grupo = `${linha}|${servico ?? ""}|${turno ?? ""}`;
      const intraJorn = tipoViagemRaw.toLowerCase().startsWith("intra");
      const { movimento, categoria } = mapMovimento(tipoViagemRaw);

      brutos.push({
        linha,
        tipo_operacao: tipoOperacao,
        versao_programacao,
        tipo_servico: null, // preenchido no passo 2, por grupo linha+serviço+turno
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

  // Passo 2: um grupo linha+serviço+turno é "TU" se QUALQUER viagem dele
  // tiver "Intra-jorn" na coluna de tipo de viagem; senão é "DIR".
  const gruposTU = new Set<string>();
  for (const b of brutos) if (b._intraJorn) gruposTU.add(b._grupo);

  const rows: ViagemParsed[] = brutos.map((b) => {
    const { _grupo, _intraJorn, ...rest } = b;
    return { ...rest, tipo_servico: gruposTU.has(_grupo) ? "TU" : "DIR" };
  });

  return { rows, errors };
}
