import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConstructorFormulario } from "@/components/formularios/constructor-formulario";
import {
  type DefinicionBorrador,
  borradorDefinicionSchema,
} from "@/lib/formularios/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar formulario — Market Track" };

const VACIA: DefinicionBorrador = { pasos: [] };

/** La definición jsonb guardada puede ser un borrador leniente; si no parsea, se
 *  empieza en blanco en vez de reventar la pantalla. */
function aDefinicion(valor: unknown): DefinicionBorrador {
  const parsed = borradorDefinicionSchema.safeParse(valor);
  return parsed.success ? parsed.data : VACIA;
}

export default async function EditarFormularioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: formulario, error }, { data: versiones }] = await Promise.all([
    supabase
      .from("formulario_levantamiento")
      .select(
        "id, nombre, activo, tenant:tenant_id(nombre), marca:marca_id(nombre)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("formulario_version")
      .select("id, version, definicion, publicada, publicada_at")
      .eq("formulario_id", id)
      .order("version", { ascending: false }),
  ]);

  if (error || !formulario) notFound();

  const lista = versiones ?? [];
  const borrador = lista.find((v) => !v.publicada);
  const publicada = lista.find((v) => v.publicada);
  // Se edita el borrador abierto; si no hay, se parte de la última publicada
  // (una edición abrirá una versión nueva sin tocar la publicada inmutable).
  const trabajo = borrador ?? publicada;

  return (
    <ConstructorFormulario
      formularioId={formulario.id}
      nombreInicial={formulario.nombre}
      activoInicial={formulario.activo}
      cliente={formulario.tenant?.nombre ?? "—"}
      marca={formulario.marca?.nombre ?? null}
      definicionInicial={aDefinicion(trabajo?.definicion)}
      versionPublicada={publicada?.version ?? null}
      publicadaAt={publicada?.publicada_at ?? null}
    />
  );
}
