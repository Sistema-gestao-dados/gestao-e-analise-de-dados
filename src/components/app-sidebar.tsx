import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Bus, Upload, Search, History, Gauge, Layers, Route as RouteIcon, FileUp, Activity, Users, ShieldAlert, ClipboardList, ListChecks, GitCompare, Clock, BarChart3, FileText, Ticket } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";

type Item = { title: string; url: string; icon: any; perm: string };
const groups: { label: string; items: Item[] }[] = [
  {
    label: "Operação",
    items: [
      
      { title: "Dashboard Operacional", url: "/dashboard-operacional", icon: Activity, perm: "dashboard_operacional" },
      { title: "Resumo Operacional", url: "/resumo-operacional", icon: ClipboardList, perm: "resumo_operacional" },
      { title: "Resumo por Linha", url: "/resumo-linha", icon: ListChecks, perm: "resumo_linha" },
      { title: "Relatório Comparativo", url: "/relatorio-comparativo", icon: GitCompare, perm: "relatorio_comparativo" },
      { title: "Jornada de Trabalho", url: "/jornada", icon: Clock, perm: "jornada" },
      { title: "Pesquisa", url: "/pesquisa", icon: Search, perm: "pesquisa" },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { title: "Linhas", url: "/linhas", icon: Bus, perm: "linhas" },
      { title: "KM", url: "/cadastro-km", icon: Gauge, perm: "cadastro_km" },
      { title: "Grupos de Linhas", url: "/cadastro-grupos", icon: Layers, perm: "cadastro_grupos" },
    ],
  },
  {
    label: "Dados",
    items: [
      { title: "Viagens", url: "/viagens", icon: RouteIcon, perm: "viagens" },
      { title: "Versões Ativas", url: "/versoes-ativas", icon: ListChecks, perm: "viagens" },
      { title: "Importação CSV", url: "/importacao", icon: Upload, perm: "importacao" },
      { title: "Importação TXT GPS", url: "/importacao-txt", icon: FileUp, perm: "importacao_txt" },
      { title: "Histórico", url: "/historico", icon: History, perm: "historico" },
    ],
  },
  {
    label: "Conversores",
    items: [
      { title: "BI Cittati → TXT", url: "/bi-cittati", icon: BarChart3, perm: "bi_cittati_conversor" },
      { title: "Relat. Viagens → TXT", url: "/relatorio-viagens", icon: FileText, perm: "relatorio_viagens_conversor" },
      { title: "Passagem Trecho → TXT", url: "/passagem-trecho", icon: Ticket, perm: "passagem_trecho_conversor" },
    ],
  },
  {
    label: "Administração",
    items: [
      { title: "Auditoria", url: "/auditoria", icon: ShieldAlert, perm: "auditoria" },
      { title: "Usuários", url: "/usuarios", icon: Users, perm: "usuarios" },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { can, isAdmin } = useAuth();

  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => (i.perm === "usuarios" ? isAdmin : can(i.perm))) }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 shadow-[var(--shadow-card)]"
            style={{ backgroundImage: "var(--gradient-primary)" }}
          >
            <Bus className="h-4.5 w-4.5 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="font-display text-sm font-semibold tracking-tight text-sidebar-foreground">Gestão e Análise</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/55">de Dados</div>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = item.url === "/" ? pathname === "/" : pathname.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
