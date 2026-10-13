import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Cache persistido mostra os dados na hora e revalida em segundo plano.
        // 120min porque viagens/linhas só mudam quando alguém importa um TXT
        // novo ou edita cadastro — e o botão "Atualizar dados" no topo já
        // força isso a qualquer momento, sem precisar esperar expirar.
        staleTime: 120 * 60_000,
        gcTime: 24 * 60 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchOnMount: true,
        retry: 1,
      },
    },
  });


  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
