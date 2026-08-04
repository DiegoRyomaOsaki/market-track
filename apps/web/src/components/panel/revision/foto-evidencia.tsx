"use client";

import { useState } from "react";

// Una foto de evidencia.
//
// Tres estados, y los tres pasan de verdad:
//   - sin subir: el binario sigue en el teléfono, no hay objeto que firmar en R2
//   - firmada: se pinta
//   - caducada: la URL vive minutos; si el supervisor deja la pestaña abierta y
//     el navegador re-pide la imagen, R2 responde 403 y quedaría un icono roto
//
// No se usa `next/image`: el host es un dominio firmado de R2 con querystring de
// caducidad, y optimizarlo pediría una allowlist de dominios y una capa de caché
// que guardaría evidencia privada.

export function FotoEvidencia({
  url,
  etiqueta,
  capturadaAt,
}: {
  url: string | undefined;
  etiqueta: string;
  capturadaAt: string;
}) {
  const [caducada, setCaducada] = useState(false);

  const pie = new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  }).format(new Date(capturadaAt));

  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <figcaption className="text-[11.5px] font-semibold">
        {etiqueta}
      </figcaption>
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
        {url === undefined ? (
          <p className="px-3 text-center text-[11.5px] text-muted-foreground">
            Pendiente de subida desde el teléfono
          </p>
        ) : caducada ? (
          <p className="px-3 text-center text-[11.5px] text-muted-foreground">
            El enlace de la evidencia caducó. Recarga la página.
          </p>
        ) : (
          // URL firmada de R2 con caducidad: no pasa por el optimizador de Next, que
          // pediría una allowlist de dominios y cachearía evidencia privada.
          <img
            src={url}
            alt={`${etiqueta}, capturada el ${pie}`}
            onError={() => setCaducada(true)}
            className="size-full object-cover"
          />
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{pie}</p>
    </figure>
  );
}
