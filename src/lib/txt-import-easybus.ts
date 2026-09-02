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
// As demais colunas que já existem no cadastro de Viagens (Tipo Op.,
// Movimento, Categoria) ficam em branco por enquanto — ainda não têm um
// equivalente definido neste layout.

import { fmtHora, tempoViagem } from "./txt-import";
import type { ViagemParsed, ParseResult } from "./txt-import";

function extrairVersaoDoNomeArquivo(nome: string): string | null {
  const m = nome.match(/_V(\d+)_/i);
  return m ? `V${m[1]}` : null;
}

type Bruto = ViagemParsed & { _grupo: string; _intraJorn: boolean };

export function parseTxtEasyBus(content: string, arquivoNome = ""): ParseResult {
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

      brutos.push({
        linha,
        tipo_operacao: null,
        versao_programacao,
        tipo_servico: null, // preenchido no passo 2, por grupo linha+serviço+turno
        servico,
        turno,
        origem,
        destino,
        tipo_movimento: null,
        categoria_movimento: null,
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
