import { BloqueUsuario } from "@/components/shell/bloque-usuario";
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
    <aside className="sticky top-0 flex h-dvh w-[248px] flex-none flex-col border-r border-border bg-background print:hidden">
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

      <BloqueUsuario nombre={nombre} detalle={cliente} />
    </aside>
  );
}
