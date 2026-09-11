import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { fetchParametrosCusto, valorHora, fmtMoeda, type ParametrosCusto } from "@/lib/custo";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DollarSign, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/** Hook pra ler os parâmetros de custo (salário, %encargos, %hora extra,
 * %noturno, janelas) — usa em qualquer tela que precise calcular custo de
 * mão de obra. Os parâmetros são únicos, salvos no banco (não é
 * preferência local do navegador), editáveis só por admin em
 * /parametros-custo. */
export function useParametrosCusto() {
  const q = useQuery({ queryKey: ["parametros-custo"], queryFn: fetchParametrosCusto });
  const params = q.data;
  return {
    params,
    salarioMensal: params?.salarioMotoristaMensal ?? 0,
    valorHora: params ? valorHora(params) : 0,
    loading: q.isLoading,
  };
}

/** Compat: mesma coisa, nome antigo (usado nas telas já construídas). */
export const useSalarioMotorista = useParametrosCusto;

/** Botão pequeno mostrando o valor/hora atual, com um resumo dos
 * percentuais — edição de verdade fica em /parametros-custo (admin-only). */
export function SalarioMotoristaButton() {
  const { params, salarioMensal, valorHora: vh } = useParametrosCusto();
  const { isAdmin } = useAuth();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs">
          <DollarSign className="h-3.5 w-3.5 mr-1" />
          {salarioMensal > 0 ? `Valor/hora: ${fmtMoeda(vh)}` : "Custo não configurado"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 text-xs">
        {salarioMensal > 0 && params ? (
          <>
            <p>Salário mensal: <strong>{fmtMoeda(salarioMensal)}</strong></p>
            <p>Valor/hora: <strong>{fmtMoeda(vh)}</strong></p>
            <p>Hora extra: <strong>+{params.horaExtraPercentual}%</strong></p>
            <p>Adicional noturno: <strong>+{params.adicionalNoturnoPercentual}%</strong></p>
            <p>Encargos sociais: <strong>+{params.encargosPercentual}%</strong></p>
          </>
        ) : (
          <p className="text-muted-foreground">Nenhum parâmetro de custo configurado ainda.</p>
        )}
        {isAdmin ? (
          <Button size="sm" variant="outline" className="w-full mt-1" asChild>
            <Link to="/parametros-custo"><Settings className="h-3.5 w-3.5 mr-1" /> Editar parâmetros</Link>
          </Button>
        ) : (
          <p className="text-[10px] text-muted-foreground">Só administrador pode editar.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
