// Armazenamento de sessão do Supabase Auth. Fora de ambientes de preview
// de builder (Lovable, etc.) isso é apenas o localStorage do navegador.
export function brokeredPreviewStorage() {
  if (typeof window === "undefined") return undefined;
  return localStorage;
}
