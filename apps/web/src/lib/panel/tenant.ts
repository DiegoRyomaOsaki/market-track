import type { Tables } from "@market-track/db";

// El cliente-marca activo del panel (staff filtra su vista por él). Se persiste en
// una cookie legible por servidor y navegador — no es dato sensible, solo un id.
export const COOKIE_TENANT = "mt_tenant";

// La forma mínima de tenant que consume el shell. Se deriva de la fila generada
// (fuente única): así no hay dos definiciones que se desincronicen.
export type Tenant = Pick<Tables<"tenant">, "id" | "nombre">;
