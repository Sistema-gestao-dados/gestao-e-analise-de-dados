import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// Este dashboard antigo foi desativado. Ao entrar no sistema, o usuário deve
// cair direto no Dashboard Operacional (rota /dashboard-operacional).
export const Route = createFileRoute("/")({
  component: RedirectToDashboardOperacional,
});

function RedirectToDashboardOperacional() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/dashboard-operacional", replace: true });
  }, [navigate]);
  return null;
}
