import { PowerSyncDatabase } from "@powersync/react-native";

import { AppSchema } from "./esquema";

// La réplica local (SQLite nativo por op-sqlite). En v2 del SDK, op-sqlite es el
// adaptador integrado: basta el nombre del archivo, sin factory.
//
// Es el ÚNICO origen de datos de los flujos de campo. Una llamada de red en el
// check-in o el levantamiento es un bug (ADR-0001): se lee de aquí.
export const db = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: "market-track.db" },
});
