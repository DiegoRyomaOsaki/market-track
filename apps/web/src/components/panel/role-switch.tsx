"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Cambio de contexto admin↔supervisor. Son enlaces (navegación real, prefetch),
// no estado local: el segmento de la URL manda, y el middleware/RLS lo respaldan.
export function RoleSwitch() {
  const enSupervisor = usePathname().startsWith("/supervisor");
  const base =
    "flex h-[30px] items-center rounded-md px-3 text-[13px] font-semibold transition-colors";
  const activo = "bg-background text-foreground shadow-sm";
  const inactivo = "text-muted-foreground hover:text-foreground";

  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-[3px]">
      <Link
        href="/admin"
        aria-current={enSupervisor ? undefined : "page"}
        className={cn(base, enSupervisor ? inactivo : activo)}
      >
        Admin
      </Link>
      <Link
        href="/supervisor"
        aria-current={enSupervisor ? "page" : undefined}
        className={cn(base, enSupervisor ? activo : inactivo)}
      >
        Supervisor
      </Link>
    </div>
  );
}
