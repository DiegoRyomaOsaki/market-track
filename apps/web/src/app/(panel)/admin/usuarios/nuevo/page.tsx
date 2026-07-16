import type { Metadata } from "next";
import Link from "next/link";

import { FormNuevoUsuario } from "@/components/usuarios/form-nuevo-usuario";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Nuevo usuario — Market Track" };

export default async function NuevoUsuarioPage() {
  const supabase = await createServerSupabaseClient();
  const [{ data: tenants }, { data: supervisores }] = await Promise.all([
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

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/usuarios"
        className="text-[13px] font-semibold text-muted-foreground hover:text-foreground"
      >
        ← Usuarios
      </Link>
      <FormNuevoUsuario
        tenants={tenants ?? []}
        supervisores={supervisores ?? []}
      />
    </div>
  );
}
