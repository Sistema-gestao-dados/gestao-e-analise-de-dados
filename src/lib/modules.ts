// Lista de módulos do sistema, agrupada do mesmo jeito que o menu lateral
// (src/components/app-sidebar.tsx). Mantida separada dos ícones pra poder
// ser usada tanto no menu quanto na árvore de permissões (Usuários), sem
// depender de componentes visuais. Se um item novo for adicionado ao menu,
// adicione a chave (perm) dele aqui também.

export type ModuleGroup = { label: string; items: { key: string; label: string }[] };

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    label: "Operação",
    items: [
      { key: "dashboard_operacional", label: "Dashboard Operacional" },
      { key: "resumo_operacional", label: "Resumo Operacional" },
      { key: "resumo_linha", label: "Resumo por Linha" },
      { key: "relatorio_comparativo", label: "Relatório Comparativo" },
      { key: "jornada", label: "Jornada de Trabalho" },
      { key: "intra_jornada", label: "Intra Jornada (TU)" },
      { key: "pesquisa", label: "Pesquisa" },
    ],
  },
  {
    label: "Previsto e Realizado",
    items: [
      { key: "realizado", label: "Realizado (Previsto x Real)" },
      { key: "importacao_realizado", label: "Importação Realizado (Cittati)" },
    ],
  },
  {
    label: "Histórico de Programação",
    items: [
      { key: "historico_reprogramacao", label: "Histórico de Reprogramação" },
      { key: "importacao_historico_reprogramacao", label: "Importação Reprogramação" },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { key: "linhas", label: "Linhas" },
      { key: "cadastro_km", label: "KM" },
      { key: "cadastro_grupos", label: "Grupos de Linhas" },
      { key: "cadastro_empresa_estacao", label: "Empresa por Estação" },
      { key: "importacao", label: "Importação CSV" },
    ],
  },
  {
    label: "Dados",
    items: [
      { key: "viagens", label: "Viagens / Versões Ativas" },
      { key: "importacao_txt", label: "Importação TXT GPS" },
      { key: "importacao_txt_easybus", label: "Importação TXT EasyBus" },
      { key: "historico", label: "Histórico de Importação" },
    ],
  },
  {
    label: "Conversores",
    items: [
      { key: "bi_cittati_conversor", label: "BI Cittati → TXT" },
      { key: "relatorio_viagens_conversor", label: "Relat. Viagens → TXT" },
      { key: "passagem_trecho_conversor", label: "Passagem Trecho → TXT" },
    ],
  },
];

/** Lista plana de todas as chaves de módulo — útil pra validação e pra
 * "marcar tudo". Não inclui "usuarios"/"auditoria": esses continuam
 * exclusivos de administrador, não fazem parte da restrição por módulo. */
export const ALL_MODULE_KEYS: string[] = MODULE_GROUPS.flatMap((g) => g.items.map((i) => i.key));
