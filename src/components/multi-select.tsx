import { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, X } from "lucide-react";

export function MultiSelect({
  label,
  values,
  onChange,
  options,
  placeholder = "Todas",
  className,
}: {
  label?: string;
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(q.toLowerCase())),
    [options, q],
  );
  const all = values.length === 0 || values.length === options.length;
  const summary =
    all ? placeholder : values.length === 1 ? values[0] : `${values.length} selecionadas`;

  const toggle = (o: string) => {
    if (values.includes(o)) onChange(values.filter((x) => x !== o));
    else onChange([...values, o]);
  };
  const selectAll = () => onChange([]);
  const clear = () => onChange([]);

  return (
    <div className={`flex flex-col gap-1 min-w-[160px] ${className ?? ""}`}>
      {label && (
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 justify-between text-xs font-normal"
          >
            <span className="truncate flex items-center gap-1">
              {!all && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {values.length}
                </Badge>
              )}
              {summary}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2" align="start">
          <div className="flex items-center gap-1 mb-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
              className="h-7 text-xs"
            />
            {!all && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={clear} title="Limpar">
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between mb-1 px-1">
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={selectAll}
            >
              Selecionar todas
            </button>
            <span className="text-[10px] text-muted-foreground">
              {values.length}/{options.length}
            </span>
          </div>
          <div className="max-h-60 overflow-auto space-y-0.5">
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center">Nenhum resultado</p>
            )}
            {filtered.map((o) => {
              const checked = values.includes(o);
              return (
                <label
                  key={o}
                  className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent cursor-pointer text-xs"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggle(o)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate flex-1">{o}</span>
                  {checked && <Check className="h-3 w-3 text-primary" />}
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
