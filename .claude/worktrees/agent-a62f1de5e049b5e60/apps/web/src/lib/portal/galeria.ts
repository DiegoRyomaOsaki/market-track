import type {
  GaleriaEvidencia,
  LevantamientoConEvidencia,
  VisitaConEvidencia,
} from "@market-track/shared";

// La lógica PURA de la galería de evidencia: qué fotos hay que firmar y cuándo
// una tarjeta tiene algo que enseñar. Fuera de la UI para poder probarla.

/**
 * Los ids que se pueden firmar: solo los de las fotos que ya están en R2.
 *
 * Pedir una URL de algo que sigue en el teléfono devolvería un enlace a un objeto
 * que no existe, y la pantalla enseñaría una imagen rota en vez de decir la
 * verdad ("aún no ha subido").
 */
export function idsFirmables(galeria: GaleriaEvidencia): string[] {
  const ids: string[] = [];
  const anotar = (f: { id: string; subida_at: string | null } | null) => {
    if (f && f.subida_at !== null) ids.push(f.id);
  };

  for (const tienda of galeria.tiendas) {
    for (const visita of tienda.visitas) {
      for (const foto of visita.fotos_visita) anotar(foto);
      for (const lev of visita.levantamientos) {
        anotar(lev.antes);
        anotar(lev.despues);
        for (const otra of lev.otras) anotar(otra);
      }
    }
  }
  return ids;
}

/**
 * La URL firmada de una foto, o `undefined` si no hay nada que enseñar.
 *
 * La regla "sin `subida_at` no hay imagen" se comprueba aquí y no solo en
 * `idsFirmables`: así el componente que pinta no depende de que un llamante
 * lejano haya filtrado bien. Una foto que sigue en el teléfono jamás enseña una
 * imagen, aunque alguien le pase un mapa con su id dentro.
 */
export function urlDe(
  foto: { id: string; subida_at: string | null } | null,
  urls: Record<string, string>,
): string | undefined {
  if (foto === null || foto.subida_at === null) return undefined;
  return urls[foto.id];
}

/** ¿Este levantamiento tiene alguna foto que enseñar, subida o no? */
export function tieneEvidencia(lev: LevantamientoConEvidencia): boolean {
  return lev.antes !== null || lev.despues !== null || lev.otras.length > 0;
}

/** Cuántas fotos de la visita siguen en el teléfono del mercaderista. */
export function pendientesDeSubida(visita: VisitaConEvidencia): number {
  const sinSubir = (f: { subida_at: string | null } | null) =>
    f !== null && f.subida_at === null ? 1 : 0;

  return (
    visita.fotos_visita.reduce((n, f) => n + sinSubir(f), 0) +
    visita.levantamientos.reduce(
      (n, l) =>
        n +
        sinSubir(l.antes) +
        sinSubir(l.despues) +
        l.otras.reduce((m, o) => m + sinSubir(o), 0),
      0,
    )
  );
}

/** Cuántas tiendas y cuántas visitas trae el árbol. Para la línea de resumen. */
export function resumen(galeria: GaleriaEvidencia): {
  tiendas: number;
  visitas: number;
} {
  return {
    tiendas: galeria.tiendas.length,
    visitas: galeria.tiendas.reduce((n, t) => n + t.visitas.length, 0),
  };
}
