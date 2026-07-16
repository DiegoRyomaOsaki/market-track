"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { type ItemNav, itemActivo } from "@/lib/panel/navegacion";
import { cn } from "@/lib/utils";

type Seccion = { titulo: string; items: readonly ItemNav[] };

export function SidebarNav({ secciones }: { secciones: Seccion[] }) {
  const activo = itemActivo(usePathname());

  return (
    <nav className="flex-1 overflow-y-auto p-3">
      {secciones.map((seccion) => (
        <div key={seccion.titulo}>
          <div className="px-2.5 pb-2 pt-4 text-[10.5px] font-bold tracking-wider text-muted-foreground first:pt-1.5">
            {seccion.titulo}
          </div>
          {seccion.items.map((item) => {
            const esActivo = activo?.href === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={esActivo ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                  esActivo
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <span className="w-[18px] text-center">{item.icono}</span>
                <span className="flex-1 text-left">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
