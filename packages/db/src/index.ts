// La forma de las filas de Postgres se GENERA, no se escribe a mano. Este paquete
// es la única fuente de verdad: las apps y `packages/shared` importan de aquí, y
// nadie redefine una fila por su cuenta.
//
// Regenerar tras cada migración:  pnpm db:types
//
// Uso:
//   import type { Tables, Enums } from "@market-track/db";
//   type Profile = Tables<"profile">;
//   type Rol = Enums<"rol_usuario">;
//
// `Constants` es el único export de valor (no de tipo): trae los enums como arrays
// en tiempo de ejecución, que es justo lo que `packages/shared` necesita para
// construir sus `z.enum(...)` sin volver a escribir la lista a mano.

export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.types";
export { Constants } from "./database.types";

// El corpus de casos del árbol de precio: DATOS, no lógica. Lo ejecutan los dos
// lados —Postgres y el espejo del móvil— para que CI se ponga rojo si divergen.
// Ver docs/adr/0012.
export type {
  CasoPrecio,
  PeriodoPrecio,
  PromocionVigente,
  VeredictoPrecio,
} from "./casos-precio";
export { CASOS_PRECIO, ORDEN_TIPO_TIENDA } from "./casos-precio";
