import Link from "next/link";

import type {
  EstadoAlerta,
  SeveridadAlerta,
  TipoAlerta,
} from "@market-track/shared";

import { Pastilla, Tarjeta, TD, TH } from "@/components/panel/tabla";
import {
  ESTILO_ESTADO,
  ESTILO_SEVERIDAD,
  ETIQUETA_ESTADO,
  ETIQUETA_SEVERIDAD,
  ETIQUETA_TIPO_ALERTA,
} from "@/lib/portal/alertas";

// La bandeja de alertas. Server Component: no hay nada interactivo aquí — el
// estado se cambia en el detalle, donde se ve la evidencia. Marcar "resuelta"
// desde una lista es resolver algo sin haberlo mirado.

export type FilaAlerta = {
  id: string;
  tipo: TipoAlerta;
  severidad: SeveridadAlerta;
  estado: EstadoAlerta;
  creado_at: string;
  tienda_nombre: string | null;
  marca_nombre: string | null;
  sku_codigo: string | null;
  sku_nombre: string | null;
};

const FECHA = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Lima",
});

/** Un hueco legítimo: la contingencia de una visita no cuelga de ninguna marca. */
function oGuion(v: string | null) {
  return v ?? "—";
}

export function TablaAlertas({
  alertas,
  querystring,
}: {
  alertas: FilaAlerta[];
  /** Los filtros vigentes, para que "volver" desde el detalle no los pierda. */
  querystring: string;
}) {
  if (alertas.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-background p-4 text-[13px] text-muted-foreground">
        No hay alertas con estos filtros.
      </p>
    );
  }

  return (
    <Tarjeta>
      <thead>
        <tr className="border-b border-border">
          <th className={TH}>Alerta</th>
          <th className={TH}>Producto</th>
          <th className={TH}>Punto de venta</th>
          <th className={TH}>Severidad</th>
          <th className={TH}>Estado</th>
          <th className={TH}>Detectada</th>
        </tr>
      </thead>
      <tbody>
        {alertas.map((a) => (
          <tr key={a.id} className="border-b border-border last:border-0">
            <td className={TD}>
              <Link
                href={`/cliente/alertas/${a.id}${querystring}`}
                className="font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {ETIQUETA_TIPO_ALERTA[a.tipo]}
              </Link>
              <div className="text-[11.5px] text-muted-foreground">
                {oGuion(a.marca_nombre)}
              </div>
            </td>
            <td className={TD}>
              {a.sku_nombre === null ? (
                "—"
              ) : (
                <>
                  <div>{a.sku_nombre}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {oGuion(a.sku_codigo)}
                  </div>
                </>
              )}
            </td>
            <td className={TD}>{oGuion(a.tienda_nombre)}</td>
            <td className={TD}>
              <Pastilla tono={ESTILO_SEVERIDAD[a.severidad]}>
                {ETIQUETA_SEVERIDAD[a.severidad]}
              </Pastilla>
            </td>
            <td className={TD}>
              <Pastilla tono={ESTILO_ESTADO[a.estado]}>
                {ETIQUETA_ESTADO[a.estado]}
              </Pastilla>
            </td>
            <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
              {FECHA.format(new Date(a.creado_at))}
            </td>
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}
