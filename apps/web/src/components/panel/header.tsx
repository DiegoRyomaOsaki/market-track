import type { RolUsuario } from "@market-track/shared";

import type { Tenant } from "@/lib/panel/tenant";

import { HeaderTitulo } from "./header-titulo";
import { HelpPopover } from "./help-popover";
import { RoleSwitch } from "./role-switch";
import { TenantSelector } from "./tenant-selector";

// Frame del header en el servidor; los controles (título por ruta, ayuda, cambio
// de rol, selector de cliente) son leaves de cliente. El role switch solo lo ve el
// admin (staff global que cambia de contexto); el supervisor solo tiene lo suyo.
export function Header({
  rol,
  tenants,
  tenantActualId,
}: {
  rol: RolUsuario;
  tenants: Tenant[];
  tenantActualId: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-[60px] flex-none items-center gap-4 border-b border-border bg-background px-6">
      <HeaderTitulo />
      <HelpPopover />
      {rol === "admin" && <RoleSwitch />}
      <TenantSelector tenants={tenants} actualId={tenantActualId} />
    </header>
  );
}
