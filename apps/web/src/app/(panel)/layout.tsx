import type { RolUsuario } from "@market-track/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Header } from "@/components/panel/header";
import { Sidebar } from "@/components/panel/sidebar";
import { COOKIE_TENANT, type Tenant } from "@/lib/panel/tenant";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Shell del panel (admin/supervisor). Server Component: trae el perfil y la lista
// de clientes-marca (staff los ve todos por RLS) y arma el layout; solo los
// controles del sidebar/header son cliente. El middleware ya protege estas rutas;
// el redirect de aquí es defensa en profundidad.
export default async function PanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [perfilRes, tenantsRes] = await Promise.all([
    supabase.from("profile").select("nombre, rol").eq("id", user.id).single(),
    supabase
      .from("tenant")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre"),
  ]);

  // Falla visible: un error de la consulta (RLS/PostgREST) no debe confundirse con
  // "sin sesión". Se registra antes del redirect defensivo.
  if (perfilRes.error) {
    console.error(
      JSON.stringify({
        evento: "panel_perfil_error",
        detalle: perfilRes.error.message.slice(0, 200),
      }),
    );
  }
  const perfil = perfilRes.data;
  if (!perfil) redirect("/login");
  const rol: RolUsuario = perfil.rol;
  const tenants: Tenant[] = tenantsRes.data ?? [];

  const cookieStore = await cookies();
  const tenantActualId =
    cookieStore.get(COOKIE_TENANT)?.value ?? tenants[0]?.id ?? null;

  return (
    <div className="flex min-h-dvh">
      <Sidebar nombre={perfil.nombre} rol={rol} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header rol={rol} tenants={tenants} tenantActualId={tenantActualId} />
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
