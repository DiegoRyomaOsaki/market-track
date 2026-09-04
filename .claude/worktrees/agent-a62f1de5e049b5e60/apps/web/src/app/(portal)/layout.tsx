import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { FiltrosGlobales } from "@/components/portal/filtros-globales";
import { HeaderPortal } from "@/components/portal/header-portal";
import { SidebarPortal } from "@/components/portal/sidebar-portal";
import { modulosDelCliente } from "@/lib/portal/estado-modulos";
import { NAV_PORTAL } from "@/lib/portal/nav";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// El portal es por usuario y con sesión: nunca se prerenderiza estático.
export const dynamic = "force-dynamic";

// Shell del portal del cliente (MAR-54). Server Component: trae el perfil, los
// módulos habilitados (para gatear el nav) y las opciones de los filtros globales
// (RLS las acota al tenant del cliente). El middleware ya protege /cliente/*; el
// redirect de aquí es defensa en profundidad. El contenido de cada sección llega
// en su ticket (MAR-55/56/57/58).
export default async function PortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [perfilRes, modulos, cadenasRes, tiendasRes] = await Promise.all([
    supabase
      .from("profile")
      .select("nombre, cliente:tenant_id(nombre)")
      .eq("id", user.id)
      .single(),
    modulosDelCliente(),
    supabase
      .from("cadena")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("tienda")
      .select("id, nombre, cadena_id")
      .eq("activo", true)
      .order("nombre"),
  ]);

  if (perfilRes.error) {
    console.error(
      JSON.stringify({
        evento: "portal_perfil_error",
        detalle: perfilRes.error.message.slice(0, 200),
      }),
    );
  }
  const perfil = perfilRes.data;
  if (!perfil) redirect("/login");

  const cliente = perfil.cliente?.nombre ?? "Tu marca";
  const items = NAV_PORTAL.filter((item) => modulos[item.modulo]);

  return (
    <div className="flex min-h-dvh">
      <SidebarPortal nombre={perfil.nombre} cliente={cliente} items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <HeaderPortal cliente={cliente} />
        <FiltrosGlobales
          cadenas={cadenasRes.data ?? []}
          tiendas={tiendasRes.data ?? []}
        />
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
