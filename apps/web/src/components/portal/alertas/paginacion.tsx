import Link from "next/link";

// La paginación de la bandeja. Server Component con enlaces reales: Next los
// prefetchea al pasar por encima y el navegador los abre en otra pestaña si a
// alguien le conviene. Un botón con `router.push` no da ninguna de las dos cosas.

const BOTON =
  "min-h-11 rounded-lg border border-border px-3 text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function enlaceA(params: URLSearchParams, pagina: number): string {
  const next = new URLSearchParams(params.toString());
  // La primera página no lleva `pagina=1` en la URL: es el estado por defecto y
  // ensuciarla haría que dos enlaces distintos apuntaran a lo mismo.
  if (pagina <= 1) next.delete("pagina");
  else next.set("pagina", String(pagina));
  const qs = next.toString();
  return qs ? `?${qs}` : "?";
}

export function Paginacion({
  pagina,
  porPagina,
  total,
  params,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  params: URLSearchParams;
}) {
  const paginas = Math.max(Math.ceil(total / porPagina), 1);
  const desde = (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);

  if (paginas <= 1) return null;

  return (
    <nav
      aria-label="Paginación de alertas"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-[12px] text-muted-foreground">
        {desde}–{hasta} de {total}
      </p>
      <div className="flex items-center gap-2">
        {pagina > 1 ? (
          <Link href={enlaceA(params, pagina - 1)} className={BOTON}>
            Anterior
          </Link>
        ) : null}
        <span className="text-[12px] text-muted-foreground">
          Página {pagina} de {paginas}
        </span>
        {pagina < paginas ? (
          <Link href={enlaceA(params, pagina + 1)} className={BOTON}>
            Siguiente
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
