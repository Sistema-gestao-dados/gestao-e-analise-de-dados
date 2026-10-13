# Regras de negócio — Gestão e Análise de Dados

Este arquivo resume as regras de domínio (transporte/ônibus) usadas em cálculos
de jornada e custo, para não precisar reexplicar a cada conversa. Detalhes de
arquitetura/stack não entram aqui — só regras de negócio.

## TU e DIR (tipo de serviço)

Nomes por extenso **não confirmados no código nem em docs** — são siglas
vindas do sistema fonte (GPS Cittati / EasyBus) e usadas sempre como sigla.
Confirmar com o time antes de expandir por extenso em qualquer lugar.
Armazenado em `viagens.tipo_servico` (text, valores `"TU"`/`"DIR"`).

**TU**
- Mesmo motorista cobre dois turnos (T1 + T2) no mesmo dia; a jornada do
  serviço é a soma dos minutos de T1 + T2. O intervalo entre os turnos
  (intrajornada) **não** conta como jornada trabalhada.
- Limite de jornada: **8h24 (504 min)** — `LIMITE_TU_MIN` em `src/lib/jornada.ts`.
- Precisa das duas pontas (T1 e T2) para "fechar"; TU com só um turno é
  "incompleto" — excluído dos totais e sinalizado como erro de cadastro
  (`src/lib/integridade.ts`).
- Janela permitida (parametrizável em `/parametros-custo`): não pode começar
  antes de 04:00 nem terminar depois de 21:00 (`tuForaDaJanela()` em `src/lib/custo.ts`).
- Intra-jornada (tela `/intra-jornada`): descanso real entre fim do 1º turno
  (já somando prestação de contas) e início do 2º (já subtraindo
  antecipação). Mínimo exigido 180 min (3h), crítico abaixo de 120 min (2h).
- Na importação EasyBus, o grupo/turno vira TU automaticamente se alguma
  viagem tiver "Intra-jorn" no meio; senão vira DIR.
- Nos resumos, TU é um bucket próprio (`"TU"`), chave
  `versao||dia||servico||TU` — uma unidade de serviço só.

**DIR**
- Cada turno é uma jornada independente, com motorista próprio por turno
  (mesmo que haja rendição de veículo).
- Limite de jornada: **7h (420 min)** — `LIMITE_DIR_MIN`.
- Buckets nos resumos: `DIR_T1` (1º turno), `DIR_T2` (2º turno), `APROV`
  (3º turno / reaproveitamento do veículo, tratado como DIR para jornada).
- Aparecem lado a lado com TU em quase todo relatório operacional: colunas
  "Dir 1º T.", "Dir 2º T.", "Aproveit.", "TU" (Resumo por Linha/Grupo,
  Comparativo).
- Flags relacionadas em `classificacao_operacional`: `tem_direto`, `tem_tu`,
  `tem_rendicao`, `tem_aproveitamento`.

Chave de agrupamento de serviço em ambos os casos: `versao||tipo||servico`
(isola `DIR#N` de `TU#N`), e na Jornada inclui também o dia tipo:
`versao||diaTipo||servico`.

## Custo de mão de obra

Calculado **sempre em runtime** (não é persistido em tabela nenhuma) a
partir de `parametros_custo` + `viagens` + `linhas`, em `src/lib/custo.ts`
(`custoServico()`). Fórmula confirmada com acordo coletivo e batida com o
sistema externo "InputBus" (ver comentário-cabeçalho do arquivo):

```
valor_hora      = salário_mensal ÷ horas_mensais_referência   (padrão 210h)
horas_normais   = min(minutosTotal, limiteMin) / 60   (limite = 7h DIR / 8h24 TU)
horas_extra     = max(0, minutosTotal - limiteMin) / 60
horas_noturnas  = minutos do turno dentro da janela 22h–05h (parametrizável) / 60

custo = valor_hora × horas_normais × (1 + %encargos)
      + valor_hora × horas_extra   × (1 + %hora_extra)     ← taxa CHEIA, não "adicional"
      + valor_hora × horas_noturnas × (%adicional_noturno)
      + valor_hora_refeicao                                 ← valor FIXO por serviço/dia, não por hora
```

Regras importantes:
- **Encargos sociais incidem só sobre horas normais** — não incidem sobre
  hora extra, noturno ou hora-refeição.
- Horas normais são limitadas ao teto do tipo de serviço (7h DIR / 8h24 TU)
  para não contar hora-extra em duplicidade.
- Hora extra usa a taxa cheia do percentual configurado, não um "adicional"
  somado à hora normal.

Parâmetros (tabela `parametros_custo`, linha única `id=1`, editável só por
administrador em `/parametros-custo`):
`salario_motorista_mensal`, `encargos_percentual` (padrão 46%),
`adicional_noturno_percentual` (padrão 20%), `hora_extra_percentual`
(padrão 50%), `horas_mensais_referencia` (padrão 210), `valor_hora_refeicao`,
`noturno_inicio_min`/`noturno_fim_min` (padrão 22:00–05:00),
`tu_inicio_minimo_min`/`tu_fim_maximo_min` (padrão 04:00–21:00).

O cálculo por serviço depende de `JornadaServico` (`buildJornadas()` em
`src/lib/jornada.ts`), que por sua vez usa `viagens` (partida/chegada/
turno/tipo_servico/tipo_operacao/servico/versao_programacao) e `linhas`
(`antec_t1/t2/t3`, `prest_t1/t2/t3` — antecipação e prestação de contas por
turno, para achar início/fim real da jornada).

Consumido (rótulo "Custo M.O." na UI) em: `/resumo-linha`,
`/resumo-operacional`, `/relatorio-comparativo`, `/dashboard-operacional`,
`/jornada`, `/intra-jornada`.

O dia tipo **não** altera a fórmula nem os parâmetros de custo — não há
percentual de acordo diferente por sábado/domingo/feriado hoje. Dia tipo só
segmenta (particiona) os relatórios de jornada/custo.

## Dia tipo

Não é enum de banco — é `text` livre, com 3 valores-base fixos e extensões
livres (feriados etc.) criadas via wizard de importação.

Valores-base (mapeados do campo "Tipo Operação" do TXT GPS Cittati, que vem
como 1/2/3):
- `"1"` → **Dias úteis**
- `"2"` → **Sábado**
- `"3"` → **Domingo**

Novos dias tipo (feriados, datas especiais) são criados/sobrescritos no
wizard de importação TXT (`/importacao-txt`, campo "Sobrescrever o Dia Tipo
do arquivo") ou no importador EasyBus (`/importacao-txt-easybus`).

Onde é armazenado:
- `viagens.tipo_operacao` — dia tipo de cada viagem importada.
- `classificacao_operacional.tipo_operacao` / `projeto_ativo.tipo_operacao`
  — usado para classificar serviços e definir a "versão ativa" por
  linha + dia tipo.
- `parametro_multilinha.tipo_dia` (nome de coluna diferente, atenção) —
  mapeia linha → `grupo_du` (Grupo de Linha "Dia Útil") por dia tipo,
  usado em `/cadastro-grupos`.
- `dia_tipo_heranca` (`tipo_dia` PK, `tipo_dia_pai`) — registra de qual dia
  tipo "pai" (Dias úteis/Sábado/Domingo) um dia tipo novo (ex. "Feriado SG
  22-09-26") herdou o comportamento (grupos de linha), definido no wizard
  `DiaTipoMapper`. Usado no Relatório Comparativo para decidir se uma linha
  "sem dado" no dia novo deve repetir os dados do pai — olhando o **grupo de
  linha inteiro**, não a linha isolada.
- `historico_reprogramacao.dia_tipo` + tabela auxiliar `historico_dia_tipos`
  — vocabulário livre e independente, usado só no módulo Histórico
  (`/historico-*`) para registrar/filtrar reprogramações por dia tipo.
  Não é o mesmo vocabulário fixo de `viagens.tipo_operacao`.

Como afeta cálculos:
- É a chave de particionamento central de quase todos os relatórios (Resumo,
  Comparativo, Dashboard, Jornada): unidades de serviço, frota, KM e custo de
  mão de obra são sempre calculados "por dia tipo" além de "por versão de
  programação".
- Determina qual Grupo de Linha (`grupo_du`) se aplica a cada linha via
  `parametro_multilinha` filtrado por `tipo_dia` — afeta relatórios
  agrupados por grupo.
- Na Jornada, entra na chave de agrupamento de serviço
  (`versao||diaTipo||servico`): o mesmo número de serviço em dias tipo
  diferentes é tratado como veículo/jornada distinta.
- **Não** altera a fórmula de custo de mão de obra (ver seção acima).

## Acesso restrito por Grupo/Empresa (Fase 2 aplicada)

Sistema é compartilhado por ~3 grupos de empresa (ex.: Grupo Maué, Grupo
Rio Ita, Grupo Coesa) e os Dia Tipo criados por um usuário de um grupo
apareciam pra todo mundo, bagunçando a lista. Decisão: não duplicar o
sistema/banco por grupo — isolar dados dentro do mesmo sistema.

- `profiles.acesso_restrito` (bool, default false) + tabela
  `user_data_access` (`user_id`, `tipo` ['grupo'|'empresa'], `valor`) —
  mesmo padrão já usado por `modulos_restritos`/`user_module_permissions`
  (restrição por tela). Igual aos módulos: desligado não muda nada pra
  ninguém, só o admin liga por usuário em `/usuarios`.
- "Grupo" aqui é o mesmo valor do filtro "GRUPO" dos relatórios
  (`linhas.ordem` + override por estação, resolvido por
  `resolveGrupoViagem`) — não confundir com "Grupo de Linha"
  (`parametro_multilinha.grupo_du`, outro conceito, usado pra agrupar
  códigos de linha tipo "01+01A+49A" nos relatórios "por Unidade").
- **Fase 1 (feita)**: só a base — tabela, coluna, tela em `/usuarios` pra
  conceder Grupos/Empresas por usuário. Não filtra nada ainda.
- **Fase 2 (feita)**: aplicada via RLS em `viagens`
  (`supabase/migrations/20261013130000_isolamento_grupo_empresa_viagens.sql`
  + correção de desempenho em
  `supabase/migrations/20261013140000_isolamento_grupo_empresa_viagens_perf.sql`).
  `resolver_grupo_viagem()`/`resolver_empresa_viagem()` (funções `STABLE`,
  sem `SECURITY DEFINER` — ver "Incidente" abaixo) recriam em SQL
  exatamente a resolução linha→grupo/empresa do TypeScript
  (`resolveGrupoViagem`/`resolveEmpresaViagem`, com exceção por estação —
  origem antes de destino). O resultado é **pré-calculado e guardado**
  em `viagens.grupo_resolvido`/`empresa_resolvida` (gatilho mantém em dia
  a cada importação/edição, e recalcula sozinho se o cadastro de uma
  linha mudar em `linhas`/`linha_empresa_estacao`) — a política RLS
  (`restringe_grupo_empresa_viagens`, RESTRICTIVE, só estreita o que a
  política base libera, nunca amplia) compara essas colunas direto, sem
  chamar função nenhuma por linha. De caminho, fechou o acesso anônimo em
  `viagens` (nunca tinha migrado pro padrão "só autenticado" das outras
  tabelas). Efeito colateral automático: a RPC `viagens_valores_distintos`
  (dropdown Dia Tipo/Versão/Arquivo de `/viagens`) é `SECURITY INVOKER`,
  então já respeita essa RLS sozinha — e o dropdown de Dia Tipo do
  Comparativo também, porque é montado a partir das próprias viagens já
  filtradas que chegam no navegador (`src/components/comparativo-view.tsx`).

  **Incidente (13/out)**: a 1ª versão da política chamava
  `usuario_tem_acesso_viagem()` (então `SECURITY DEFINER`) por linha, pra
  cada uma das ~55 mil viagens, toda vez que Resumo/Comparativo/Dashboard
  baixavam a tabela inteira (`fetchAllViagens`/`fetchAllPaginado`, 55
  páginas em paralelo) — isso tornou essas telas inutilizáveis por
  alguns minutos em produção (não é só teoria: medido ao vivo, ~6s só
  pras 10 primeiras páginas). A correção trocou "calcular na leitura"
  por "guardar já calculado" (colunas + gatilho, acima). Se mexer de
  novo nessa política, **testar primeiro com `fetchAllViagens`-like**
  (múltiplas páginas em paralelo), não só uma linha isolada — uma
  função RLS correta por linha pode ainda assim ser inviável em escala.

  **Incidente 2 (13/out, mesmo dia)**: mesmo depois da correção acima
  (política já rápida por linha), Resumo/Comparativo/Dashboard/Jornada
  continuaram derrubando — causa raiz diferente, em
  `src/lib/fetch-paginado.ts`: a função buscava as ~55 páginas de 1000
  linhas de `viagens` em PARALELO usando `.range()` (OFFSET/LIMIT).
  OFFSET fica mais caro quanto maior o valor (pular 45 mil linhas exige
  varrer e descartar essas 45 mil primeiro); disparar ~55 dessas ao
  mesmo tempo sobrecarregou o banco a ponto de várias página devolverem
  erro 500 depois de 8-30s cada — mesmo com a política já barata.
  Reescrito pra busca por CURSOR (keyset/"seek method":
  `WHERE col > cursor ORDER BY col LIMIT 1000`, sequencial, uma página
  de cada vez) — custo constante por página, não cresce com a
  profundidade. Mais lento que o paralelo ideal (~19s pra buscar
  `viagens` inteira, contra quase instantâneo antes), mas não quebra.
  **Lição**: uma política RLS rápida não é garantia nenhuma se o padrão
  de busca do lado do cliente escala mal (OFFSET alto + muita
  paralelismo = contenção no banco, com ou sem RLS). Se a velocidade
  virar problema, a forma certa de acelerar é descobrir os cursores de
  cada página de antemão (consulta leve, só a coluna de ordenação) e
  paralelizar os `.gt()` a partir daí — não voltar pro offset puro.
- **Fase 3 (pendente)**: Dia Tipo criado por um usuário restrito só
  aparece pra quem tem acesso ao mesmo grupo/empresa.

## Observações / pontos em aberto

- Os nomes por extenso de **TU** e **DIR** não estão confirmados em nenhum
  lugar do repositório — se for necessário escrevê-los por extenso em
  telas/relatórios/documentação nova, confirmar antes com quem manda os
  arquivos fonte (GPS Cittati / EasyBus) ou com o time de operação.
