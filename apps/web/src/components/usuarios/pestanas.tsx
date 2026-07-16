import Link from "next/link";

import { cn } from "@/lib/utils";

export const TABS = [
  { key: "mercaderistas", label: "Mercaderistas" },
  { key: "supervisores", label: "Supervisores" },
  { key: "clientes", label: "Clientes (portal)" },
  { key: "clientes-marca", label: "Clientes-marca" },
] as const;

export type TabUsuarios = (typeof TABS)[number]["key"];

export function esTab(valor: string | undefined): valor is TabUsuarios {
  return TABS.some((t) => t.key === valor);
}

// Pestañas como enlaces (?tab=): server-rendered, navegación real con prefetch.
export function Pestanas({ activa }: { activa: TabUsuarios }) {
  return (
    <div
      role="tablist"
      aria-label="Tipo de usuario"
      className="flex gap-1.5 rounded-[10px] bg-muted p-1"
    >
      {TABS.map((t) => {
        const esActiva = t.key === activa;
        return (
          <Link
            key={t.key}
            href={`/admin/usuarios?tab=${t.key}`}
            role="tab"
            aria-selected={esActiva}
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
    </div>
  );
}
