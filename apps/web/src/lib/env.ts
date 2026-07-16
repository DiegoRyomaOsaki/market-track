import { parseEnvPublico } from "@market-track/shared";

// Next solo incrusta en el bundle del navegador las referencias LITERALES a
// `process.env.NEXT_PUBLIC_*` — no un spread de `process.env`. Por eso se nombran
// una a una y se traducen al esquema SIN prefijo que valida `@market-track/shared`
// (única fuente de la validación de env; aquí no se redefine).
export const env = parseEnvPublico({
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
