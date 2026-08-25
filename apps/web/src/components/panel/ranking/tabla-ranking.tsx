import Link from "next/link";

import { enlaceTabla } from "@/components/panel/estilos";
import { Avatar, Pastilla, Tarjeta, TD, TH } from "@/components/panel/tabla";
import {
  descripcionDeltaPosicion,
  formatearDelta,
  formatearDeltaPosicion,
  textoDePosicion,
} from "@market-track/shared";
import type { FilaRanking } from "@/lib/ranking/datos";

// La tabla del ranking. Sin lógica propia: posición, empates, deltas y sus
// textos salen de `@market-track/shared`, que es donde se prueban y de donde
// los lee también el móvil: dos copias dirían "2.º" y "3.º" del mismo dato.

function pct(valor: number | null): string {
  return valor === null ? "—" : `${valor}`;
}

export function TablaRanking({
  filas,
  hrefDetalle,
}: {
  filas: FilaRanking[];
  hrefDetalle: (mercaderistaId: string) => string;
}) {
  return (
    <Tarjeta>
      <thead>
        <tr className="border-b border-border bg-muted/40">
          <th scope="col" className={TH}>
            PUESTO
          </th>
          <th scope="col" className={TH}>
            MERCADERISTA
          </th>
          <th scope="col" className={TH}>
            TOTAL
          </th>
          <th scope="col" className={TH}>
            PUNTUALIDAD
          </th>
          <th scope="col" className={TH}>
            ASISTENCIA
          </th>
          <th scope="col" className={TH}>
            CALIDAD
          </th>
          <th scope="col" className={TH}>
            HERRAMIENTAS
          </th>
          <th scope="col" className={TH}>
            Δ TOTAL
          </th>
          <th scope="col" className={TH}>
            Δ PUESTO
          </th>
          <th scope="col" className={TH}>
            NIVEL DE BONO
          </th>
          <th scope="col" className={TH}>
            ESTADO
          </th>
          <th scope="col" className={TH}>
            <span className="sr-only">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr
            key={f.mercaderista_id}
            className="border-b border-border last:border-0"
          >
            <td className={`${TD} font-semibold tabular-nums`}>
              {textoDePosicion(f.posicion, f.hay_empate)}
            </td>
            <td className={TD}>
              <div className="flex items-center gap-2.5">
                <Avatar nombre={f.nombre} />
                <span className="font-semibold">{f.nombre}</span>
                {!f.activo && (
                  <Pastilla tono="bg-muted text-muted-foreground">
                    Desvinculado
                  </Pastilla>
                )}
              </div>
            </td>
            <td className={`${TD} font-semibold tabular-nums`}>
              {f.total_pct === null ? "Sin datos" : f.total_pct}
            </td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              {pct(f.puntualidad_pct)}
            </td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              {pct(f.asistencia_pct)}
            </td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              {pct(f.calidad_pct)}
            </td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              {pct(f.herramientas_pct)}
            </td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              {formatearDelta(f.total_pct, f.total_anterior)}
              {f.config_distinta && (
                <span
                  className="ml-1 text-[11px]"
                  title="El periodo anterior se calculó con otra configuración"
                >
                  (config distinta)
                </span>
              )}
            </td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              <span aria-hidden="true">
                {formatearDeltaPosicion(f.posicion, f.posicion_anterior)}
              </span>
              <span className="sr-only">
                {descripcionDeltaPosicion(f.posicion, f.posicion_anterior)}
              </span>
            </td>
            <td className={TD}>
              {f.nivel_bono === null ? (
                <span className="text-muted-foreground">Sin nivel</span>
              ) : (
                <span>
                  {f.nivel_bono}
                  <span className="ml-1 text-muted-foreground">
                    S/ {f.nivel_bono_monto}
                  </span>
                </span>
              )}
            </td>
            <td className={TD}>
              {/* La píldora lleva SIEMPRE texto: el color no es el único
                  portador del significado. */}
              {f.cierre_bloqueado ? (
                <Pastilla tono="bg-alerta-suave text-alerta-texto">
                  Cierre bloqueado
                </Pastilla>
              ) : f.cerrado ? (
                <Pastilla tono="bg-completado-suave text-completado-texto">
                  Cerrado
                </Pastilla>
              ) : (
                <Pastilla tono="bg-muted text-muted-foreground">
                  Abierto
                </Pastilla>
              )}
            </td>
            <td className={`${TD} text-right`}>
              <Link
                href={hrefDetalle(f.mercaderista_id)}
                className={enlaceTabla}
              >
                Detalle
                <span className="sr-only"> de {f.nombre}</span>
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}
