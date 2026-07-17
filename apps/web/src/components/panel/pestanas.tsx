import Link from "next/link";

import { cn } from "@/lib/utils";

// Pestañas del panel como enlaces: cada una es una URL distinta (navegación real
// con prefetch), así que el patrón correcto es <nav> + aria-current, no el widget
// ARIA de tabs (que implicaría teclas de flecha que aquí no aplican).
//
// Genérico a propósito: lo usan Usuarios y Catálogo. Cada sección da sus ítems y
// cómo se construye el href.

export type ItemPestana = { key: string; label: string };

export function Pestanas({
  items,
  activa,
  href,
  etiqueta,
}: {
  items: readonly ItemPestana[];
  activa: string;
  href: (key: string) => string;
  etiqueta: string;
}) {
  return (
    <nav
      aria-label={etiqueta}
      className="flex flex-wrap gap-1.5 rounded-[10px] bg-muted p-1"
    >
      {items.map((t) => {
        const esActiva = t.key === activa;
        return (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={esActiva ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
              esActiva
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
