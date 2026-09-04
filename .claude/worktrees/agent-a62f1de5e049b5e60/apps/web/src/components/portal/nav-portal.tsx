"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { type ItemPortal, itemPortalActivo } from "@/lib/portal/nav";
import { cn } from "@/lib/utils";

// La navegación del portal. Solo llegan las secciones HABILITADAS (el layout ya
// filtró por módulo). Cada enlace PRESERVA los filtros globales de la URL para que
// persistan al cambiar de sección.
export function NavPortal({ items }: { items: readonly ItemPortal[] }) {
  const activo = itemPortalActivo(usePathname());
  const qs = useSearchParams().toString();
  const sufijo = qs ? `?${qs}` : "";

  return (
    <nav className="flex-1 overflow-y-auto p-3">
      <div className="px-2.5 pb-2 pt-1.5 text-[10.5px] font-bold tracking-wider text-muted-foreground">
        PORTAL
      </div>
      {items.map((item) => {
        const esActivo = activo?.href === item.href;
        return (
          <Link
            key={item.href}
            href={`${item.href}${sufijo}`}
            aria-current={esActivo ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
              esActivo
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-muted",
            )}
          >
            <span aria-hidden="true" className="w-[18px] text-center">
              {item.icono}
            </span>
            <span className="flex-1 text-left">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
