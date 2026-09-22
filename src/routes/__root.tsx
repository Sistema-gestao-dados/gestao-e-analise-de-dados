import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Moon, Sun, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import packageJson from "../../package.json";

// Slot pra telas informarem a "contagem de registros" da status bar do
// rodapé sem precisar prop-drill — cada tela chama useStatusBarCount(n) e
// o número some sozinho quando a tela desmonta (troca de rota).
const StatusBarContext = createContext<{ setCount: (n: number | null) => void } | null>(null);

export function useStatusBarCount(n: number | null) {
  const ctx = useContext(StatusBarContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setCount(n);
    return () => ctx.setCount(null);
  }, [ctx, n]);
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const isDark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", isDark);
    setDark(isDark);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className="h-8 w-8 flex items-center justify-center rounded-md border border-border hover:bg-accent transition-colors"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function ClientDate() {
  const [d, setD] = useState<string>("");
  useEffect(() => {
    setD(new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }));
  }, []);
  return <div className="ml-auto text-xs text-muted-foreground" suppressHydrationWarning>{d}</div>;
}

import appCss from "../styles.css?url";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar, groups } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90">
            Ir para o dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

// Depois de um deploy novo, os arquivos JS de cada tela trocam de nome
// (hash no arquivo). Uma aba que já estava aberta antes do deploy tenta
// buscar o arquivo velho, que não existe mais — daí esse erro específico do
// Vite/ESM. `router.invalidate()` não resolve (não busca o HTML/manifesto
// novo); só um reload de página de verdade pega a versão atual. Guarda em
// sessionStorage pra não entrar em loop se o erro persistir por outro motivo.
const CHUNK_ERROR_PATTERN = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;
const CHUNK_RELOAD_GUARD_KEY = "chunk-error-reload";

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const isChunkError = CHUNK_ERROR_PATTERN.test(error.message);
  const alreadyTriedReload =
    typeof sessionStorage !== "undefined" && sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === "1";

  useEffect(() => {
    if (isChunkError && !alreadyTriedReload) {
      sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, "1");
      window.location.reload();
    }
  }, [isChunkError, alreadyTriedReload]);

  if (isChunkError && !alreadyTriedReload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-foreground">Atualizando o sistema…</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Uma nova versão foi publicada. Recarregando automaticamente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">
          {isChunkError ? "Não foi possível atualizar automaticamente" : "Esta página não carregou"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isChunkError
            ? "Uma nova versão foi publicada, mas o recarregamento automático não resolveu. Recarregue a página manualmente (Ctrl+Shift+R)."
            : error.message}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              if (isChunkError) {
                sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
                window.location.reload();
                return;
              }
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Gestão e Análise de Dados" },
      { name: "description", content: "Sistema corporativo de gestão e análise de dados operacionais de transporte, com conversores de arquivos integrados." },
      { property: "og:title", content: "Gestão e Análise de Dados" },
      { name: "twitter:title", content: "Gestão e Análise de Dados" },
      { property: "og:description", content: "Sistema corporativo de gestão e análise de dados operacionais de transporte, com conversores de arquivos integrados." },
      { name: "twitter:description", content: "Sistema corporativo de gestão e análise de dados operacionais de transporte, com conversores de arquivos integrados." },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      const { createSyncStoragePersister } = await import("@tanstack/query-sync-storage-persister");
      const { persistQueryClient } = await import("@tanstack/react-query-persist-client");
      if (cancelled) return;
      const persister = createSyncStoragePersister({
        storage: window.localStorage,
        key: "transitops-query-cache-v4",
        throttleTime: 1000,
      });
      persistQueryClient({
        queryClient: queryClient as any,
        persister,
        maxAge: 24 * 60 * 60 * 1000, // 24h
        // Trocar o buster descarta qualquer cache antigo no localStorage dos
        // usuários — necessário aqui porque a v4 tinha queries que
        // persistiam um Map (calendario-categoria-cor, dia-tipo-heranca) e
        // corrompiam pra "{}" nesse round-trip, quebrando a página inteira
        // ao reidratar. Sem trocar o buster, o fix no código não some com o
        // que já está salvo no navegador de quem já usou o sistema.
        buster: "v5-sem-map-persistido",
        dehydrateOptions: {
          // Nunca persiste um Map/Set: o localStorage serializa em JSON, e
          // JSON.stringify(new Map()) vira "{}" — na próxima carga o dado
          // volta como objeto comum, sem `.get()`/`.has()`, e quebra a
          // página inteira (já aconteceu com calendario-categoria-cor e
          // dia-tipo-heranca). queryFn deve sempre devolver array/objeto
          // plano; quem precisa de Map monta via useMemo, nunca no cache.
          shouldDehydrateQuery: (query: any) => {
            const data = query.state.data;
            if (data instanceof Map || data instanceof Set) return false;
            return query.state.status === "success";
          },
        },
      });
    })();
    return () => { cancelled = true; };
  }, [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RefreshAllButton() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      await qc.invalidateQueries();
      await qc.refetchQueries({ type: "active" });
      toast.success("Dados atualizados.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="Atualizar dados da tela"
      className="h-8 px-2 flex items-center gap-1.5 rounded-md border border-border hover:bg-accent transition-colors text-xs disabled:opacity-60"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">Atualizar dados</span>
    </button>
  );
}

function AuthGate() {
  const { user, loading, can } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const navigate = useNavigate();
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const statusBarValue = useMemo(() => ({ setCount: setRecordCount }), []);
  useEffect(() => {
    if (loading) return;
    if (!user && pathname !== "/login") {
      const next = pathname + search;
      navigate({ to: "/login", search: { next }, replace: true });
    }
  }, [user, loading, pathname, search, navigate]);

  // Bloqueio por módulo também na rota (não só escondendo do menu) — pega o
  // item de menu cujo url mais se aproxima do caminho atual. Reaproveitado
  // pro título da barra de topo/rodapé (nome do módulo atual), não só pra
  // checagem de permissão.
  const activeItem = useMemo(() => {
    let best: { url: string; perm: string; title: string } | null = null;
    for (const g of groups) {
      for (const item of g.items) {
        if (pathname === item.url || pathname.startsWith(item.url + "/")) {
          if (!best || item.url.length > best.url.length) best = item;
        }
      }
    }
    return best;
  }, [pathname]);
  const requiredPerm = activeItem?.perm ?? null;
  const allowed = !requiredPerm || can(requiredPerm);
  useEffect(() => {
    if (loading || !user) return;
    if (!allowed) navigate({ to: "/", replace: true });
  }, [loading, user, allowed, navigate]);

  if (pathname === "/login") return <Outlet />;
  if (loading || !user) return null;
  if (!allowed) return null;
  return (
    <SidebarProvider>
      <StatusBarContext.Provider value={statusBarValue}>
        <div className="h-screen flex w-full bg-background overflow-hidden">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0 h-full">
            <header className="h-10 shrink-0 flex items-center gap-2 border-b border-border bg-card px-3 z-10">
              <SidebarTrigger className="h-7 w-7" />
              <div className="font-display text-[13px] font-semibold tracking-tight text-foreground truncate">
                {activeItem?.title ?? "Painel Operacional"}
              </div>
              <ClientDate />
              <RefreshAllButton />
              <ThemeToggle />
              <UserBadge />
            </header>
            <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-4">
              <Outlet />
            </main>
            <footer className="h-6 shrink-0 flex items-center gap-2.5 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80">{user.nome}</span>
              <span className="opacity-40">·</span>
              <span className="truncate">{activeItem?.title ?? "—"}</span>
              {recordCount != null && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="tabular-nums">{recordCount.toLocaleString("pt-BR")} registro(s)</span>
                </>
              )}
              <span className="ml-auto shrink-0">v{packageJson.version}</span>
            </footer>
          </div>
        </div>
      </StatusBarContext.Provider>
    </SidebarProvider>
  );
}

function UserBadge() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2">
      <div className="text-xs text-muted-foreground hidden sm:block">
        {user.nome} <span className="text-[10px] uppercase opacity-70">({user.isAdmin ? "admin" : "user"})</span>
      </div>
      <button
        onClick={() => { logout(); navigate({ to: "/login", search: { next: "/" }, replace: true }); }}
        className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent transition-colors"
      >
        Sair
      </button>
    </div>
  );
}
