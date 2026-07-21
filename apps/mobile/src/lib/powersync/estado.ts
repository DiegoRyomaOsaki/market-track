import { useEffect, useState } from "react";

import { db } from "./db";

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

async function contarPendientes(): Promise<number> {
  // `ps_crud` es la cola de subida interna de PowerSync sobre la réplica local:
  // contarla es la forma verificable de saber cuántas ops faltan por subir.
  const filas = await db.getAll<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ps_crud",
  );
  return filas[0]?.n ?? 0;
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
      const pendientes = await contarPendientes().catch(() => 0);
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
