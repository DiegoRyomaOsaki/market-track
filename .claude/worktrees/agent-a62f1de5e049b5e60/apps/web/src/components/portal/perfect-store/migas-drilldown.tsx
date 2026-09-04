import Link from "next/link";

import type { Miga } from "@/lib/portal/perfect-store";

// El rastro del drill-down. Sin él, bajar tres niveles deja al cliente sin
// manera de subir uno: el botón "atrás" del navegador es lo único que quedaría, y
// no dice en qué corte está parado.
export function MigasDrilldown({ migas }: { migas: Miga[] }) {
  const ultima = migas.length - 1;

  return (
    <nav aria-label="Nivel del desglose">
      <ol className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {migas.map((miga, i) => (
          <li key={miga.href} className="flex items-center gap-1.5">
            {i > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground">
                ›
              </span>
            ) : null}
            {i === ultima ? (
              <span aria-current="page" className="font-semibold">
                {miga.etiqueta}
              </span>
            ) : (
              <Link
                href={miga.href}
                className="inline-flex min-h-11 items-center text-muted-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {miga.etiqueta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
