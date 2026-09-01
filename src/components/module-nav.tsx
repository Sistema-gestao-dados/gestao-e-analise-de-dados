import { Link } from "@tanstack/react-router";

interface ModuleNavProps {
  active: "bi-cittati" | "relatorio-viagens" | "passagem-trecho";
}

const linkBase =
  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap";
const linkActive = "bg-primary text-primary-foreground";
const linkInactive =
  "border border-border text-muted-foreground hover:bg-accent hover:text-foreground";

export function ModuleNav({ active }: ModuleNavProps) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm">
      <Link
        to="/bi-cittati"
        className={`${linkBase} ${active === "bi-cittati" ? linkActive : linkInactive}`}
      >
        Módulo 1 — BI Cittati
      </Link>
      <Link
        to="/relatorio-viagens"
        className={`${linkBase} ${active === "relatorio-viagens" ? linkActive : linkInactive}`}
      >
        Módulo 2 — Relat. Viagens
      </Link>
      <Link
        to="/passagem-trecho"
        className={`${linkBase} ${active === "passagem-trecho" ? linkActive : linkInactive}`}
      >
        Módulo 3 — Passagem Trecho
      </Link>
    </nav>
  );
}
