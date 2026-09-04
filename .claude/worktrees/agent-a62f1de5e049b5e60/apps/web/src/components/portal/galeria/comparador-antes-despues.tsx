import type { FotoDePar } from "@market-track/shared";

import { FotoEvidencia } from "@/components/evidencia/foto-evidencia";
import { urlDe } from "@/lib/portal/galeria";

// El comparador antes/después de una marca en una visita.
//
// Lado a lado, sin deslizador de barrido. Un barrido solo compara si las dos
// imágenes están alineadas, y dos fotos a pulso de una góndola tomadas con
// cuarenta minutos de diferencia, desde distinto ángulo y distancia, no lo están:
// sería lo más vistoso y lo que menos informa. Además, sin widget no hay nada que
// teclear — la accesibilidad sale gratis y esto es un Server Component.
//
// Es el mismo reparto que usa la pantalla de revisión del panel, así que
// supervisor y cliente miran la evidencia con el mismo modelo mental.

/** Falta la foto: son dos hechos distintos y no se pueden decir con el mismo texto. */
function RanuraVacia({ etiqueta }: { etiqueta: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <figcaption className="text-[11.5px] font-semibold">
        {etiqueta}
      </figcaption>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted">
        <p className="px-3 text-center text-[11.5px] text-muted-foreground">
          El mercaderista no registró esta foto
        </p>
      </div>
    </figure>
  );
}

export function ComparadorAntesDespues({
  antes,
  despues,
  urls,
  rotulo,
}: {
  antes: FotoDePar | null;
  despues: FotoDePar | null;
  urls: Record<string, string>;
  /** Qué par es, para que un lector de pantalla sepa de qué marca y visita. */
  rotulo: string;
}) {
  if (antes === null && despues === null) {
    return (
      <p className="rounded-lg bg-muted px-3 py-2 text-[11.5px] text-muted-foreground">
        Sin evidencia fotográfica en esta visita.
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Antes y después — ${rotulo}`}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {antes ? (
        <FotoEvidencia
          url={urlDe(antes, urls)}
          etiqueta="Antes"
          capturadaAt={antes.capturada_at}
          aspecto="4/3"
        />
      ) : (
        <RanuraVacia etiqueta="Antes" />
      )}
      {despues ? (
        <FotoEvidencia
          url={urlDe(despues, urls)}
          etiqueta="Después"
          capturadaAt={despues.capturada_at}
          aspecto="4/3"
        />
      ) : (
        <RanuraVacia etiqueta="Después" />
      )}
    </div>
  );
}
