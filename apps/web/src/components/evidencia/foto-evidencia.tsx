"use client";

import { useEffect, useRef, useState } from "react";

import type { TipoFoto } from "@market-track/shared";

// Una foto de evidencia. La comparten el panel del staff y el portal del cliente:
// las dos pantallas tienen que decir exactamente lo mismo sobre por qué una foto
// no se ve, y con dos copias esa verdad se desincroniza.
//
// Cuatro estados, y los cuatro pasan de verdad:
//   - sin subir: el binario sigue en el teléfono, no hay objeto que firmar en R2
//   - cargando: la URL está firmada pero los bytes vienen en camino
//   - firmada: se pinta
//   - caducada: la URL vive minutos; si se deja la pestaña abierta y el navegador
//     re-pide la imagen, R2 responde 403 y quedaría un icono roto
//
// No se usa `next/image`: el host es un dominio firmado de R2 con querystring de
// caducidad, y optimizarlo pediría una allowlist de dominios y una capa de caché
// que guardaría evidencia privada.

/** El nombre de cada tipo de foto. Exhaustivo: si el enum crece, deja de compilar. */
export const ETIQUETA_FOTO: Record<TipoFoto, string> = {
  selfie: "Selfie de check-in",
  antes: "Antes",
  despues: "Después",
  sos: "Share of Shelf",
  exhibicion: "Exhibición",
  precio: "Precio",
  contingencia: "Contingencia",
};

const PROPORCION = {
  /** La rejilla densa del panel de revisión. */
  "3/4": "aspect-[3/4]",
  /** La galería del portal, donde la foto es el contenido. */
  "4/3": "aspect-[4/3]",
} as const;

export function FotoEvidencia({
  url,
  etiqueta,
  capturadaAt,
  aspecto = "3/4",
}: {
  url: string | undefined;
  etiqueta: string;
  capturadaAt: string;
  aspecto?: keyof typeof PROPORCION;
}) {
  const [caducada, setCaducada] = useState(false);
  const [cargando, setCargando] = useState(true);
  const img = useRef<HTMLImageElement>(null);

  // Una imagen ya cacheada puede completar ANTES de que React enganche el
  // `onLoad`: sin esto, el esqueleto se quedaría encima de una foto que ya está.
  useEffect(() => {
    if (img.current?.complete) setCargando(false);
  }, [url]);

  const pie = new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  }).format(new Date(capturadaAt));

  const pintandoImagen = url !== undefined && !caducada;

  return (
    <figure
      className="flex min-w-0 flex-col gap-1"
      aria-busy={pintandoImagen && cargando}
    >
      <figcaption className="text-[11.5px] font-semibold">
        {etiqueta}
      </figcaption>
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-lg border border-border bg-muted ${PROPORCION[aspecto]}`}
      >
        {url === undefined ? (
          <p className="px-3 text-center text-[11.5px] text-muted-foreground">
            Pendiente de subida desde el teléfono
          </p>
        ) : caducada ? (
          <p className="px-3 text-center text-[11.5px] text-muted-foreground">
            El enlace de la evidencia caducó. Recarga la página.
          </p>
        ) : (
          <>
            {cargando ? (
              <>
                <div
                  aria-hidden="true"
                  className="absolute inset-0 animate-pulse bg-muted"
                />
                {/* Que algo viene en camino no puede comunicarse solo con una
                    animación: quien usa lector de pantalla también tiene derecho
                    a saberlo. */}
                <span className="sr-only">Cargando imagen</span>
              </>
            ) : null}
            {/* URL firmada de R2 con caducidad: no pasa por el optimizador de
                Next, que pediría una allowlist de dominios y cachearía evidencia
                privada. */}
            <img
              ref={img}
              src={url}
              alt={`${etiqueta}, capturada el ${pie}`}
              // Una galería son decenas de fotos: solo se piden las que entran en
              // pantalla. OJO: con `lazy`, una imagen fuera del pliegue no dispara
              // `onLoad` hasta que se hace scroll — su esqueleto sigue pulsando
              // mientras tanto, y es correcto: aún no ha empezado a cargar.
              loading="lazy"
              decoding="async"
              onLoad={() => setCargando(false)}
              onError={() => {
                setCargando(false);
                setCaducada(true);
              }}
              className="size-full object-cover"
            />
          </>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{pie}</p>
    </figure>
  );
}
