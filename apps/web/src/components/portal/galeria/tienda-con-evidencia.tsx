import Link from "next/link";

import type { TiendaConEvidencia as Tienda } from "@market-track/shared";

import {
  ETIQUETA_FOTO,
  FotoEvidencia,
} from "@/components/evidencia/foto-evidencia";
import { Pastilla } from "@/components/panel/tabla";
import { pendientesDeSubida, urlDe } from "@/lib/portal/galeria";

import { ComparadorAntesDespues } from "./comparador-antes-despues";

// Un punto de venta con su evidencia: una sección por visita, y dentro un par
// antes/después por MARCA.
//
// Esa jerarquía se enseña a propósito. El par vive por marca, no por tienda: una
// tienda con Oster y Sharpie tiene dos góndolas en pasillos distintos. Aplanarlo
// haría creer al cliente que faltan fotos.

const FECHA = new Intl.DateTimeFormat("es-PE", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Lima",
});

export function TiendaConEvidencia({
  tienda,
  urls,
  enlazarDetalle = true,
}: {
  tienda: Tienda;
  urls: Record<string, string>;
  /** En la propia página de la tienda el enlace sobraría. */
  enlazarDetalle?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold">
          {enlazarDetalle ? (
            <Link
              href={`/cliente/tienda/${tienda.id}`}
              className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {tienda.nombre}
            </Link>
          ) : (
            tienda.nombre
          )}{" "}
          <span className="font-normal text-muted-foreground">
            · {tienda.cadena_nombre}
          </span>
        </h2>
        <span className="text-[11.5px] text-muted-foreground">
          {tienda.visitas.length}{" "}
          {tienda.visitas.length === 1 ? "visita" : "visitas"}
        </span>
      </div>

      {tienda.visitas.map((visita) => {
        const sinSubir = pendientesDeSubida(visita);
        return (
          <article
            key={visita.id}
            className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[12px] font-semibold capitalize">
                {FECHA.format(new Date(visita.check_in_at))}
              </h3>
              {sinSubir > 0 ? (
                <Pastilla tono="bg-en-curso-suave text-en-curso-texto">
                  {sinSubir === 1
                    ? "1 foto aún en el teléfono"
                    : `${sinSubir} fotos aún en el teléfono`}
                </Pastilla>
              ) : null}
            </div>

            {visita.levantamientos.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">
                Sin levantamiento registrado en esta visita.
              </p>
            ) : (
              visita.levantamientos.map((lev) => (
                <div key={lev.id} className="flex flex-col gap-2">
                  <p className="text-[12px]">
                    <span className="font-semibold">{lev.marca_nombre}</span>
                    <span className="text-muted-foreground">
                      {lev.sos_frentes_propios === null
                        ? ""
                        : ` · ${lev.sos_frentes_propios} frentes propios`}
                      {lev.quiebres > 0 ? ` · ${lev.quiebres} quiebre(s)` : ""}
                    </span>
                  </p>
                  <ComparadorAntesDespues
                    antes={lev.antes}
                    despues={lev.despues}
                    urls={urls}
                    rotulo={`${lev.marca_nombre}, ${FECHA.format(new Date(visita.check_in_at))}`}
                  />
                  {lev.otras.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {lev.otras.map((f) => (
                        <FotoEvidencia
                          key={f.id}
                          url={urlDe(f, urls)}
                          etiqueta={ETIQUETA_FOTO[f.tipo]}
                          capturadaAt={f.capturada_at}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}

            {visita.fotos_visita.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {visita.fotos_visita.map((f) => (
                  <FotoEvidencia
                    key={f.id}
                    url={urlDe(f, urls)}
                    etiqueta={ETIQUETA_FOTO[f.tipo]}
                    capturadaAt={f.capturada_at}
                  />
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
