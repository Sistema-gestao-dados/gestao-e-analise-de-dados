import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchLinhas, fetchKm, fetchMulti } from "@/lib/data";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuditView } from "@/lib/use-audit-view";

export const Route = createFileRoute("/pesquisa")({
  head: () => ({ meta: [{ title: "Pesquisa — Gestão e Análise de Dados" }] }),
  component: PesquisaPage,
});

function PesquisaPage() {
  useAuditView("pesquisa");
  const linhasQ = useQuery({ queryKey: ["linhas"], queryFn: fetchLinhas });
  const kmQ = useQuery({ queryKey: ["km"], queryFn: fetchKm });
  const multiQ = useQuery({ queryKey: ["multi"], queryFn: fetchMulti });
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return { linhas: [], trechos: [], multi: [] };
    const linhas = (linhasQ.data ?? []).filter((l) =>
      [l.linha, l.empresa, l.unidade, l.categoria].some((v) => (v ?? "").toString().toLowerCase().includes(ql))
    );
    const trechos = (kmQ.data ?? []).filter((k) =>
      [k.linha, k.origem, k.destino, k.descricao].some((v) => (v ?? "").toString().toLowerCase().includes(ql))
    );
    const multi = (multiQ.data ?? []).filter((m) =>
      [m.linha, m.grupo_du, m.tipo_dia].some((v) => (v ?? "").toString().toLowerCase().includes(ql))
    );
    return { linhas, trechos, multi };
  }, [q, linhasQ.data, kmQ.data, multiQ.data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pesquisa Global</h1>
        <p className="text-sm text-muted-foreground">Busque por linha, empresa, unidade, trecho, origem/destino e mais.</p>
      </div>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9 h-11 text-base" placeholder="Digite para pesquisar em todas as planilhas..." value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
        </CardContent>
      </Card>

      {q.trim() && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="Linhas" count={results.linhas.length}>
            {results.linhas.slice(0, 20).map((l) => (
              <Link key={l.linha} to="/linhas" className="block px-3 py-2 rounded-md hover:bg-accent transition-colors text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{l.linha}</span>
                  {l.categoria && <Badge variant="outline" className="text-[10px]">{l.categoria}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{l.empresa}</div>
              </Link>
            ))}
          </Section>
          <Section title="Trechos" count={results.trechos.length}>
            {results.trechos.slice(0, 20).map((t) => (
              <div key={t.id} className="px-3 py-2 rounded-md hover:bg-accent text-sm">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{t.linha}</span><span className="tabular-nums text-muted-foreground">{Number(t.km).toFixed(1)} km</span></div>
                <div className="text-xs text-muted-foreground truncate">{t.origem} → {t.destino}</div>
              </div>
            ))}
          </Section>
          <Section title="Multilinha" count={results.multi.length}>
            {results.multi.slice(0, 20).map((m) => (
              <div key={m.id} className="px-3 py-2 rounded-md hover:bg-accent text-sm">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{m.linha}</span><Badge variant="secondary" className="text-[10px]">{m.tipo_dia}</Badge></div>
                <div className="text-xs text-muted-foreground truncate">Grupo: {m.grupo_du}</div>
              </div>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="p-3">
        <div className="flex items-center justify-between px-1 py-1.5 mb-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <Badge variant="secondary">{count}</Badge>
        </div>
        {count === 0 ? <div className="text-xs text-muted-foreground py-6 text-center">Sem resultados</div> : <div className="space-y-0.5">{children}</div>}
      </CardContent>
    </Card>
  );
}
