import Link from "next/link";

import { Aviso, Tarjeta, TD, TH } from "@/components/panel/tabla";
import type { FilaDesglose, Nivel } from "@/lib/portal/perfect-store";
import { ETIQUETA_NIVEL } from "@/lib/portal/perfect-store";

// El desglose del nivel actual del drill-down. Cada fila con clave es un enlace
// que baja un nivel; las que no la tienen —un grupo "Sin clasificar"— se muestran
// igual, porque esconderlas haría que el desglose no sumara el puntaje de arriba,
// pero no llevan a ninguna parte.
export function TablaDesglose({
  nivel,
  filas,
  hrefDeFila,
}: {
  nivel: Nivel;
  filas: FilaDesglose[];
  hrefDeFila: (clave: string) => string;
}) {
  if (filas.length === 0) {
    return (
      <Aviso>
        No hay levantamientos puntuados para el periodo y los filtros
        seleccionados.
      </Aviso>
    );
  }

  return (
    <Tarjeta>
      <caption className="px-4 pt-3 text-left text-[11.5px] text-muted-foreground">
        Puntaje por {ETIQUETA_NIVEL[nivel].toLowerCase()}, del más bajo al más
        alto.
      </caption>
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className={TH}>
            {ETIQUETA_NIVEL[nivel]}
          </th>
          <th scope="col" className={TH}>
            Puntaje
          </th>
          <th scope="col" className={TH}>
            Distribución
          </th>
          <th scope="col" className={TH}>
            Visibilidad
          </th>
          <th scope="col" className={TH}>
            Precio
          </th>
          <th scope="col" className={TH}>
            Levantamientos
          </th>
        </tr>
      </thead>
      <tbody>
        {filas.map((fila) => (
          <tr
            key={fila.clave ?? `sin-clave-${fila.etiqueta}`}
            className="border-b border-border last:border-0"
          >
            <th scope="row" className={`${TD} text-left font-semibold`}>
              {fila.clave ? (
                <Link
                  href={hrefDeFila(fila.clave)}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  {fila.etiqueta}
                </Link>
              ) : (
                fila.etiqueta
              )}
            </th>
            <td className={`${TD} font-semibold`}>{pct(fila.total_pct)}</td>
            <td className={TD}>{pct(fila.distribucion_pct)}</td>
            <td className={TD}>{pct(fila.visibilidad_pct)}</td>
            <td className={TD}>{pct(fila.precio_pct)}</td>
            <td className={TD}>{fila.levantamientos}</td>
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}

/** Un porcentaje que puede no existir. Se dice, no se convierte en cero. */
function pct(v: number | null): string {
  return v == null ? "Sin datos" : `${v}%`;
}
