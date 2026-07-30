import type { Metadata } from "next";

import { FormModulos } from "@/components/portal/form-modulos";
import { SelectorCliente } from "@/components/portal/selector-cliente";
import { Aviso } from "@/components/panel/tabla";
import { estadoDeModulos } from "@/lib/portal/modulos";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Portal cliente — Market Track" };

// Config de los módulos del portal por cliente (MAR-81), sobre el modelo de
// MAR-74. Un selector de cliente arriba; para el elegido, sus módulos.

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string | string[] }>;
}) {
  const clienteId = primero((await searchParams).cliente);

  const supabase = await createServerSupabaseClient();
  const { data: clientes } = await supabase
    .from("tenant")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");

  if (!clientes?.length) {
    return (
      <Aviso>
        No hay clientes. Crea un cliente antes de configurar su portal.
      </Aviso>
    );
  }

  const seleccionado = clientes.find((c) => c.id === clienteId) ?? null;

  // La config del cliente elegido: sus overrides, con el default (todo
  // habilitado) resuelto por `estadoDeModulos`. El admin ve todo por RLS.
  let estado = null;
  if (seleccionado) {
    const { data: overrides } = await supabase
      .from("portal_modulo_habilitado")
      .select("modulo, habilitado")
      .eq("tenant_id", seleccionado.id);
    estado = estadoDeModulos(overrides ?? []);
  }

  return (
    <div className="flex flex-col gap-4">
      <SelectorCliente
        clientes={clientes}
        seleccionado={seleccionado?.id ?? ""}
      />

      {seleccionado && estado ? (
        <FormModulos
          tenantId={seleccionado.id}
          nombreCliente={seleccionado.nombre}
          estadoInicial={estado}
        />
      ) : (
        <Aviso>
          Elige un cliente para ver y configurar los módulos de su portal.
        </Aviso>
      )}
    </div>
  );
}
