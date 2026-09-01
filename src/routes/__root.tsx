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
import { useEffect, useState, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Moon, Sun, RefreshCw } from "lucide-react";
import { toast } from "sonner";

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
import { AppSidebar } from "@/components/app-sidebar";
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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">Esta página não carregou</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
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
        buster: "v4-dados-completos",
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
  const { user, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (!user && pathname !== "/login") {
      const next = pathname + search;
      navigate({ to: "/login", search: { next }, replace: true });
    }
  }, [user, loading, pathname, search, navigate]);
  if (pathname === "/login") return <Outlet />;
  if (loading || !user) return null;
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center gap-3 border-b border-border bg-card/80 backdrop-blur-md px-4 md:px-6 sticky top-0 z-10 shadow-[var(--shadow-card)]">
            <SidebarTrigger />
            <div className="font-display text-sm font-semibold tracking-tight text-foreground">Painel Operacional</div>
            <ClientDate />
            <RefreshAllButton />
            <ThemeToggle />
            <UserBadge />
          </header>
          <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-x-hidden max-w-[1800px] w-full mx-auto">
            <Outlet />
          </main>
        </div>
      </div>
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
