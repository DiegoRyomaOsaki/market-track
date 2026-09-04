import type { Session } from "@supabase/supabase-js";
import { createContext, useContext } from "react";

// La sesión, disponible para las pantallas sin volver a preguntarle a Supabase.
export const SesionContexto = createContext<Session | null>(null);

export function useSesion(): Session | null {
  return useContext(SesionContexto);
}
