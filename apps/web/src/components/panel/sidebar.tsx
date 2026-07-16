import type { RolUsuario } from "@market-track/shared";

import { NAV_ADMIN, NAV_SUPERVISOR } from "@/lib/panel/navegacion";

import { SidebarNav } from "./sidebar-nav";

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  const dos = ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
  return dos || "?";
}

// El admin (staff global) ve ambas secciones; el supervisor solo la suya.
export function Sidebar({ nombre, rol }: { nombre: string; rol: RolUsuario }) {
  const secciones =
    rol === "admin"
      ? [
          { titulo: "ADMINISTRADOR", items: NAV_ADMIN },
          { titulo: "SUPERVISOR", items: NAV_SUPERVISOR },
        ]
      : [{ titulo: "SUPERVISOR", items: NAV_SUPERVISOR }];

  return (
    <aside className="sticky top-0 flex h-dvh w-[248px] flex-none flex-col border-r border-border bg-background">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <div className="flex size-[30px] items-center justify-center rounded-lg bg-primary text-[15px] font-extrabold text-primary-foreground">
          M
        </div>
        <div>
          <div className="text-[15px] font-extrabold tracking-tight">
            Market Track
          </div>
          <div className="text-[11px] font-medium text-muted-foreground">
            Panel de gestión
          </div>
        </div>
      </div>

      <SidebarNav secciones={secciones} />

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-2">
          <div className="flex size-8 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground">
            {iniciales(nombre)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold">{nombre}</div>
            <div className="text-[11px] capitalize text-muted-foreground">
              {rol}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
