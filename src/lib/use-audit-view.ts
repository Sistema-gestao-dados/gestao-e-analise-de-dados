import { useEffect, useRef } from "react";
import { logAudit } from "@/lib/audit";

/** Registra um único evento "view" por montagem da tela. */
export function useAuditView(entity: string) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void logAudit({ action: "view", entity });
  }, [entity]);
}
