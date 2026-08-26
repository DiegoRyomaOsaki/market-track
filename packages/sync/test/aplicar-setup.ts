// `pnpm --filter @market-track/sync sync:setup`.
//
// Aplica `config/postgres-setup.sql` sin depender de `psql`: en Windows no está
// garantizado y `pnpm bootstrap` no lo audita. Hace falta después de CADA
// `supabase db reset`, porque el reset se lleva la publicación por delante.

import { prepararPostgres } from "./preparacion";

await prepararPostgres();
console.log("Postgres preparado para PowerSync: rol, grants y publicación.");
