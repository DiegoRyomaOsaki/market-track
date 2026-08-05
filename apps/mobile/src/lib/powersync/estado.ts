import { useEffect, useState } from "react";

import { db } from "./db";
import { mensajeDeError } from "../error";

// El estado de sincronización de la réplica local, para el indicador de conexión.
//
// La cola de REGISTROS es la del motor de sync (lo que falta subir al backend).
// La cola de FOTOS es aparte (cola de disco a R2, ver lib/cola-fotos) — por eso
// una visita puede estar sincronizada con sus fotos aún pendientes.

export type EstadoSync = {
  conectado: boolean;
  subiendo: boolean;
  bajando: boolean;
  pendientesRegistros: number;
};

export async function contarPendientes(): Promise<number> {
  // La API pública del SDK para la cola de subida. Antes se consultaba la tabla
  // interna `ps_crud` a mano, pero es un detalle de implementación que puede
  // cambiar de versión: si su forma cambia, el conteo mentiría sin avisar.
  const { count } = await db.getUploadQueueStats();
  return count;
}

export function useEstadoSync(): EstadoSync {
  const [estado, setEstado] = useState<EstadoSync>({
    conectado: false,
    subiendo: false,
    bajando: false,
    pendientesRegistros: 0,
  });

  useEffect(() => {
    let vivo = true;

    async function refrescar() {
      const s = db.currentStatus;
      // Si el conteo falla no se puede mostrar un número real, pero tampoco se
      // calla: un "0 pendientes" silencioso haría creer que todo subió. Se
      // registra el fallo y se muestra 0 como último recurso.
      const pendientes = await contarPendientes().catch((error: unknown) => {
        console.warn(
          "No se pudo contar la cola de subida: " + mensajeDeError(error),
        );
        return 0;
      });
      if (!vivo) return;
      setEstado({
        conectado: s.connected,
        subiendo: s.dataFlowStatus.uploading,
        bajando: s.dataFlowStatus.downloading,
        pendientesRegistros: pendientes,
      });
    }

    void refrescar();
    // El listener se dispara al conectar/desconectar y al avanzar la subida:
    // ahí se recuenta la cola.
    const quitar = db.registerListener({
      statusChanged: () => void refrescar(),
    });

    return () => {
      vivo = false;
      quitar();
    };
  }, []);

  return estado;
}
