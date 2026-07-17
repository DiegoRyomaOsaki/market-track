// La decisión del segundo factor, aparte de la UI para poder probarla.
//
// Supabase da un factor de tipo "Teléfono" por usuario (ADR-0008); el código
// llega por correo vía el hook `send_sms`. Aquí solo se decide, a partir de los
// factores que ya tiene el usuario, si hay que enrolar uno o ya se puede pedir
// el código.

export type FactorMfa = {
  id: string;
  factor_type: string;
  status: string;
};

/**
 * El factor de teléfono con el que challenger, o null si no hay ninguno usable.
 *
 * Se prefiere uno verificado; si solo hay un enrolamiento a medias de un intento
 * anterior, se reutiliza en vez de crear un duplicado (Supabase no deja tener dos
 * factores de teléfono).
 */
export function factorUsable(factores: readonly FactorMfa[]): FactorMfa | null {
  const telefonicos = factores.filter((f) => f.factor_type === "phone");
  return (
    telefonicos.find((f) => f.status === "verified") ?? telefonicos[0] ?? null
  );
}

export type PasoLogin = "credenciales" | "telefono" | "codigo";

/** Con los factores del usuario, ¿toca enrolar teléfono o ya pedir el código? */
export function pasoTras2fa(factores: readonly FactorMfa[]): PasoLogin {
  return factorUsable(factores) ? "codigo" : "telefono";
}
