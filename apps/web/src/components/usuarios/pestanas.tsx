import { Pestanas } from "@/components/panel/pestanas";

export const TABS = [
  { key: "mercaderistas", label: "Mercaderistas" },
  { key: "supervisores", label: "Supervisores" },
  { key: "clientes", label: "Clientes (portal)" },
] as const;

export type TabUsuarios = (typeof TABS)[number]["key"];

export function esTab(valor: string | undefined): valor is TabUsuarios {
  return TABS.some((t) => t.key === valor);
}

export function PestanasUsuarios({ activa }: { activa: TabUsuarios }) {
  return (
    <Pestanas
      items={TABS}
      activa={activa}
      href={(k) => `/admin/usuarios?tab=${k}`}
      etiqueta="Tipo de usuario"
    />
  );
}
