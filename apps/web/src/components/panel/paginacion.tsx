import Link from "next/link";

import { botonSecundario } from "@/components/panel/estilos";

// La paginación como enlaces: anterior y siguiente son URLs reales (navegación
// con prefetch), no botones con estado. Cada sección da cómo se construye el
// href para conservar sus propios query params — el mismo contrato que
// <Pestanas>.
//
// Sin «página N de M» a propósito: el total exigiría un COUNT sobre el
// conjunto entero que la política deja ver, que es el mismo costo que la
// paginación elimina.

export function Paginacion({
  pagina,
  hayAnterior,
  haySiguiente,
  href,
}: {
  pagina: number;
  hayAnterior: boolean;
  haySiguiente: boolean;
  href: (pagina: number) => string;
}) {
  if (!hayAnterior && !haySiguiente) return null;

  return (
    <nav aria-label="Paginación" className="flex items-center gap-3">
      {hayAnterior ? (
        <Link href={href(pagina - 1)} className={botonSecundario}>
          ← Anterior
        </Link>
      ) : (
        <span className={`${botonSecundario} opacity-40`} aria-hidden="true">
          ← Anterior
        </span>
      )}
      <span className="text-[12.5px] font-semibold text-muted-foreground">
        Página {pagina}
      </span>
      {haySiguiente ? (
        <Link href={href(pagina + 1)} className={botonSecundario}>
          Siguiente →
        </Link>
      ) : (
        <span className={`${botonSecundario} opacity-40`} aria-hidden="true">
          Siguiente →
        </span>
      )}
    </nav>
  );
}
