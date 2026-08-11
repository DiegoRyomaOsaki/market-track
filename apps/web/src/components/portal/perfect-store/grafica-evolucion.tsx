import Link from "next/link";

import { Aviso } from "@/components/panel/tabla";
import type { BarraSerie } from "@/lib/portal/perfect-store";
import { ETIQUETA_GRANULARIDAD } from "@/lib/portal/perfect-store";
import { cn } from "@/lib/utils";

type Granularidad = keyof typeof ETIQUETA_GRANULARIDAD;

// La evolución del puntaje. Barras en HTML y no una librería de gráficas: son
// una docena de valores en una escala fija de 0 a 100, y traerse un motor de
// charts para eso costaría bundle y obligaría a un componente de cliente. Esto
// se renderiza en el servidor y no manda un byte de JavaScript.
//
// La gráfica es decorativa para quien no la ve: los mismos números salen en la
// tabla `sr-only` de abajo (WCAG 1.4.1 — el alto de una barra es color y forma,
// no un dato legible).
export function GraficaEvolucion({
  barras,
  granularidad,
  hrefDeGranularidad,
}: {
  barras: BarraSerie[];
  granularidad: Granularidad;
  hrefDeGranularidad: (g: Granularidad) => string;
}) {
  const conDatos = barras.filter((b) => b.valor != null).length;

  return (
    <section className="rounded-xl border border-border bg-background p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Evolución del puntaje</h2>
        <nav aria-label="Granularidad de la serie" className="flex gap-1">
          {(Object.keys(ETIQUETA_GRANULARIDAD) as Granularidad[]).map((g) => (
            <Link
              key={g}
              href={hrefDeGranularidad(g)}
              scroll={false}
              aria-current={g === granularidad ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-lg px-3 text-[12px] font-semibold",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                g === granularidad
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {ETIQUETA_GRANULARIDAD[g]}
            </Link>
          ))}
        </nav>
      </header>

      {barras.length === 0 ? (
        <Aviso>No hay periodos que mostrar en el rango seleccionado.</Aviso>
      ) : (
        <>
          {conDatos === 0 ? (
            <p className="mb-3 text-[11.5px] text-muted-foreground">
              Ningún periodo del rango tiene visitas puntuadas.
            </p>
          ) : null}

          <div aria-hidden="true" className="flex h-40 items-end gap-1.5">
            {barras.map((b) => (
              <div
                key={b.periodo}
                className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1"
              >
                <span className="text-center text-[10px] font-semibold text-muted-foreground">
                  {b.valor == null ? "—" : b.valor}
                </span>
                {/* Un periodo sin puntaje no dibuja barra: un hueco se ve como
                    un hueco, no como un cero. */}
                <div
                  className={cn(
                    "w-full rounded-t-sm",
                    b.valor == null ? "bg-muted" : "bg-accent",
                  )}
                  style={{
                    height: b.valor == null ? "2px" : `${b.altura * 100}%`,
                  }}
                />
              </div>
            ))}
          </div>

          <div aria-hidden="true" className="mt-1.5 flex gap-1.5">
            {barras.map((b) => (
              <span
                key={b.periodo}
                className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground"
              >
                {b.etiqueta}
              </span>
            ))}
          </div>

          <table className="sr-only">
            <caption>
              Puntaje Perfect Store por {ETIQUETA_GRANULARIDAD[granularidad]}
            </caption>
            <thead>
              <tr>
                <th scope="col">Periodo</th>
                <th scope="col">Puntaje</th>
                <th scope="col">Levantamientos</th>
              </tr>
            </thead>
            <tbody>
              {barras.map((b) => (
                <tr key={b.periodo}>
                  <th scope="row">{b.etiqueta}</th>
                  <td>{b.valor == null ? "Sin datos" : `${b.valor}%`}</td>
                  <td>{b.levantamientos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
