import { parseEnvPublico } from "@market-track/shared";

// Expo solo incrusta en el bundle las referencias LITERALES a
// `process.env.EXPO_PUBLIC_*` — no un spread de process.env. Por eso se nombran
// una a una y se traducen al esquema SIN prefijo que valida `@market-track/shared`
// (única fuente de la validación de env; aquí no se redefine).
//
// TILES_URL no se pasa: el móvil NO lleva mapa (ADR-0009). Su geocerca es un
// cálculo de distancia.
export const env = parseEnvPublico({
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  POWERSYNC_URL: process.env.EXPO_PUBLIC_POWERSYNC_URL,
});
