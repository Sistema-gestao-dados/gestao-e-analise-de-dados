// Human-readable Portuguese description of an audit event.
// Used by the Auditoria page so users don't need to read raw JSON.

const ENTITY_LABEL: Record<string, string> = {
  linhas: "Cadastro de Linhas",
  parametro_km: "Cadastro de KM",
  parametro_multilinha: "Grupos de Linhas",
  viagens: "Viagens",
  jornada: "Jornada de Trabalho",
  resumo_operacional: "Resumo Operacional",
  resumo_linha: "Resumo por Linha",
  relatorio_comparativo: "Relatório Comparativo",
  dashboard_operacional: "Dashboard Operacional",
  pesquisa: "Pesquisa",
  historico: "Histórico de Importações",
  importacao: "Importação CSV",
  importacao_txt: "Importação TXT GPS",
  users: "Usuários",
  auditoria: "Auditoria",
  projeto_ativo: "Versões Ativas",
  classificacao_operacional: "Classificação Operacional",
};

const FORMAT_LABEL: Record<string, string> = {
  xlsx: "Excel",
  pdf: "PDF",
  print: "impressão",
  csv: "CSV",
};

function entityLabel(entity?: string | null): string {
  if (!entity) return "";
  return ENTITY_LABEL[entity] ?? entity;
}

function n(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export function describeAuditEvent(row: {
  action: string;
  entity?: string | null;
  entity_id?: string | null;
  details?: any;
  username?: string | null;
}): string {
  const who = row.username?.trim() || "Usuário";
  const ent = entityLabel(row.entity);
  const d = row.details ?? {};

  switch (row.action) {
    case "login_success":
      return `${who} entrou no sistema.`;
    case "login_fail":
      return `Tentativa de login falhou${d?.email ? ` (${d.email})` : ""}.`;
    case "logout":
      return `${who} saiu do sistema.`;

    case "view": {
      if (row.entity === "users") return `${who} acessou a tela de Usuários.`;
      return `${who} acessou ${ent || "uma página"}.`;
    }

    case "create": {
      if (row.entity === "users") {
        return `${who} criou o usuário ${d?.email ?? ""}${d?.isAdmin ? " (administrador)" : ""}.`.trim();
      }
      const id = row.entity_id ? ` "${row.entity_id}"` : "";
      return `${who} criou registro${id} em ${ent || "cadastro"}.`;
    }

    case "update": {
      if (row.entity === "users") {
        const parts: string[] = [];
        if (d?.password_changed) parts.push("senha alterada");
        if (d?.isAdmin !== undefined) parts.push(d.isAdmin ? "promovido a administrador" : "removido de administrador");
        if (d?.ativo !== undefined) parts.push(d.ativo ? "ativado" : "desativado");
        const extra = parts.length ? ` (${parts.join(", ")})` : "";
        return `${who} atualizou o usuário ${d?.email ?? row.entity_id ?? ""}${extra}.`.trim();
      }
      const id = row.entity_id ? ` "${row.entity_id}"` : "";
      return `${who} editou registro${id} em ${ent || "cadastro"}.`;
    }

    case "delete": {
      if (row.entity === "users") return `${who} excluiu o usuário ${d?.email ?? row.entity_id ?? ""}.`.trim();
      const count = n(d?.count);
      if (count !== null && count > 1) return `${who} excluiu ${count} registros em ${ent || "cadastro"}.`;
      const id = row.entity_id ? ` "${row.entity_id}"` : "";
      return `${who} excluiu registro${id} em ${ent || "cadastro"}.`;
    }

    case "import": {
      const arq = d?.arquivo ? ` do arquivo "${d.arquivo}"` : "";
      const tipo = d?.tipo ? ` (${d.tipo})` : ent ? ` em ${ent}` : "";
      const ins = n(d?.inserted);
      const upd = n(d?.updated);
      const err = n(d?.erros);
      const stats: string[] = [];
      if (ins !== null) stats.push(`${ins} inseridos`);
      if (upd !== null && upd > 0) stats.push(`${upd} atualizados`);
      if (err !== null && err > 0) stats.push(`${err} erros`);
      const statsTxt = stats.length ? ` — ${stats.join(", ")}` : "";
      return `${who} importou${tipo}${arq}${statsTxt}.`;
    }

    case "export": {
      const fmt = d?.format ? (FORMAT_LABEL[d.format] ?? d.format) : "";
      const rows = n(d?.rows) ?? n(d?.count);
      const rowsTxt = rows !== null ? ` (${rows.toLocaleString("pt-BR")} registros)` : "";
      const fmtTxt = fmt ? ` em ${fmt}` : "";
      return `${who} exportou ${ent || "relatório"}${fmtTxt}${rowsTxt}.`;
    }

    default:
      return `${who} — ${row.action}${ent ? ` em ${ent}` : ""}.`;
  }
}
