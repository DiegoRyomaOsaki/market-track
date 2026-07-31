import { iniciales } from "@/lib/panel/iniciales";
import type { ItemPortal } from "@/lib/portal/nav";

import { NavPortal } from "./nav-portal";

// El sidebar del portal del cliente. Mono-tenant: sin cambio de rol ni selector de
// cliente (el cliente es uno). Solo recibe las secciones ya habilitadas.
export function SidebarPortal({
  nombre,
  cliente,
  items,
}: {
  nombre: string;
  cliente: string;
  items: readonly ItemPortal[];
}) {
  return (
    <aside className="sticky top-0 flex h-dvh w-[248px] flex-none flex-col border-r border-border bg-background">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <div
          aria-hidden="true"
          className="flex size-[30px] items-center justify-center rounded-lg bg-primary text-[15px] font-extrabold text-primary-foreground"
        >
          M
        </div>
        <div>
          <div className="text-[15px] font-extrabold tracking-tight">
            Market Track
          </div>
          <div className="text-[11px] font-medium text-muted-foreground">
            Portal del cliente
          </div>
        </div>
      </div>

      <NavPortal items={items} />

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-2">
          <div
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground"
          >
            {iniciales(nombre)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold">{nombre}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {cliente}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
