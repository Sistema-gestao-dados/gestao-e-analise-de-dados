// Filtros do Histórico de Reprogramação — o mesmo bloco na tela Consultar e
// no Relatório PDF (regras em filtrarHistorico, src/lib/historico.ts).

import { useMemo } from "react";
import { MESES, chaveLinha, type FiltrosHistorico, type Historico } from "@/lib/historico";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/multi-select";

const OPCOES_MES = MESES.map((nome, i) => ({ value: String(i + 1).padStart(2, "0"), label: nome }));

export function HistoricoFiltros({ historico, filtros, onChange, empresas, grupos, linhaDoCadastro }: {
  historico: Historico[];
  filtros: FiltrosHistorico;
  onChange: (f: FiltrosHistorico) => void;
  empresas: string[];
  grupos: string[];
  /** Código da linha como no Cadastro ("1" -> "01"), pra lista de opções. */
  linhaDoCadastro: (linha: string) => string;
}) {
  const set = <K extends keyof FiltrosHistorico>(k: K, v: FiltrosHistorico[K]) => onChange({ ...filtros, [k]: v });

  const opts = useMemo(() => {
    // Uma opção por linha ("1" e "01" viram a mesma, no formato do cadastro).
    const porChave = new Map<string, string>();
    for (const h of historico) {
      const k = chaveLinha(h.linha);
      if (!porChave.has(k)) porChave.set(k, linhaDoCadastro(h.linha));
    }
    const anos = (campo: "vigencia" | "encerramento") =>
      Array.from(new Set(historico.map((h) => h[campo]?.slice(0, 4)).filter(Boolean) as string[])).sort().reverse();
    return {
      linha: Array.from(porChave.values()).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
      diaTipo: Array.from(new Set(historico.map((h) => h.dia_tipo).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "pt-BR")),
      anoVig: anos("vigencia"),
      anoEnc: anos("encerramento"),
    };
  }, [historico, linhaDoCadastro]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
      <MultiSelect label="Linha" values={filtros.linha} onChange={(v) => set("linha", v)} options={opts.linha} placeholder="Todas" />
      <Campo label="Empresa"><Opcoes value={filtros.empresa} onChange={(v) => set("empresa", v)} options={empresas} /></Campo>
      <Campo label="Grupo de Linha"><Opcoes value={filtros.grupo} onChange={(v) => set("grupo", v)} options={grupos} /></Campo>
      <MultiSelect label="Dia Tipo" values={filtros.diaTipo} onChange={(v) => set("diaTipo", v)} options={opts.diaTipo} placeholder="Todos" />
      <Campo label="Versão (nº)"><Input value={filtros.versao} onChange={(e) => set("versao", e.target.value)} placeholder="Ex.: 215" inputMode="numeric" /></Campo>
      <Campo label="Ativo">
        <Opcoes value={filtros.ativo} onChange={(v) => set("ativo", v)} options={[{ value: "S", label: "Sim" }, { value: "N", label: "Não" }]} />
      </Campo>

      <Campo label="Ano da vigência"><Opcoes value={filtros.anoVig} onChange={(v) => set("anoVig", v)} options={opts.anoVig} /></Campo>
      <Campo label="Mês da vigência"><Opcoes value={filtros.mesVig} onChange={(v) => set("mesVig", v)} options={OPCOES_MES} /></Campo>
      <Campo label="Ano do encerramento"><Opcoes value={filtros.anoEnc} onChange={(v) => set("anoEnc", v)} options={opts.anoEnc} /></Campo>
      <Campo label="Mês do encerramento"><Opcoes value={filtros.mesEnc} onChange={(v) => set("mesEnc", v)} options={OPCOES_MES} /></Campo>
      <Campo label="Vigência de"><Input type="date" value={filtros.vigDe} onChange={(e) => set("vigDe", e.target.value)} /></Campo>
      <Campo label="Vigência até"><Input type="date" value={filtros.vigAte} onChange={(e) => set("vigAte", e.target.value)} /></Campo>

      <Campo label="Situação">
        <Opcoes
          value={filtros.situacao}
          onChange={(v) => set("situacao", v)}
          options={[
            { value: "vigente", label: "Vigente hoje" },
            { value: "futuro", label: "Começa no futuro" },
            { value: "encerrado", label: "Encerrado" },
            { value: "sem_fim", label: "Sem encerramento" },
          ]}
        />
      </Campo>
      <Campo label="Referência"><Input value={filtros.referencia} onChange={(e) => set("referencia", e.target.value)} placeholder="Buscar..." /></Campo>
      <div className="col-span-2">
        <Campo label="Alteração (texto)"><Input value={filtros.alteracao} onChange={(e) => set("alteracao", e.target.value)} placeholder="Buscar no texto da alteração..." /></Campo>
      </div>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Opcoes({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">Todos</SelectItem>
        {options.map((o) => {
          const { value: v, label } = typeof o === "string" ? { value: o, label: o } : o;
          return <SelectItem key={v} value={v}>{label}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}
