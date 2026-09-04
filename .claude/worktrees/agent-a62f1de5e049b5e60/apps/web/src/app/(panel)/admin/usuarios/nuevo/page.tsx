import type { Metadata } from "next";
import Link from "next/link";

import { FormNuevoUsuario } from "@/components/usuarios/form-nuevo-usuario";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nuevo usuario — Market Track" };

export default async function NuevoUsuarioPage() {
  const supabase = await createServerSupabaseClient();
  const [tenantsRes, supRes] = await Promise.all([
    supabase
      .from("tenant")
      .select("id, nombre")
      .eq("activo", true)
      .order("nombre"),
    supabase
      .from("profile")
      .select("id, nombre")
      .eq("rol", "supervisor")
      .eq("activo", true)
      .order("nombre"),
  ]);
  // Falla visible: unos selects vacíos por un error de carga son indistinguibles
  // de "no hay datos"; se avisa en su lugar.
  const error = tenantsRes.error ?? supRes.error;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/usuarios"
        className="text-[13px] font-semibold text-muted-foreground hover:text-foreground"
      >
        ← Usuarios
      </Link>
      {error ? (
        <div className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
          No se pudieron cargar las opciones del formulario. Recarga la página.
        </div>
      ) : (
        <FormNuevoUsuario
          tenants={tenantsRes.data ?? []}
          supervisores={supRes.data ?? []}
        />
      )}
    </div>
  );
}
