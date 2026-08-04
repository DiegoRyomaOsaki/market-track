import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConstructorFormulario } from "@/components/formularios/constructor-formulario";
import { Aviso } from "@/components/panel/tabla";
import {
  type DefinicionBorrador,
  borradorDefinicionSchema,
} from "@/lib/formularios/schema";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Editar formulario — Market Track" };

const VACIA: DefinicionBorrador = { pasos: [] };

/**
 * La definición jsonb guardada puede ser un borrador leniente.
 *
 * Si NO parsea hay que distinguir dos casos, porque tratarlos igual pierde
 * trabajo: una versión **inexistente** (formulario recién creado) se edita desde
 * cero, pero una versión **guardada que ya no valida** —por ejemplo una anterior
 * a los topes de tamaño— no puede abrirse en blanco: el admin vería un editor
 * vacío, pulsaría "Guardar borrador" y machacaría lo que había. Ahí se avisa y
 * no se deja editar.
 */
function aDefinicion(
  valor: unknown,
): { ok: true; definicion: DefinicionBorrador } | { ok: false } {
  if (valor == null) return { ok: true, definicion: VACIA };
  const parsed = borradorDefinicionSchema.safeParse(valor);
  return parsed.success ? { ok: true, definicion: parsed.data } : { ok: false };
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
  const definicion = aDefinicion(trabajo?.definicion);

  if (!definicion.ok) {
    console.error("[formularios] definición guardada ilegible", {
      formulario: formulario.id,
      version: trabajo?.version,
    });
    return (
      <Aviso>
        La versión guardada de este formulario no se puede leer con las reglas
        actuales. No se abre el editor para no sobrescribirla: revisa la
        definición antes de continuar.
      </Aviso>
    );
  }

  return (
    <ConstructorFormulario
      formularioId={formulario.id}
      nombreInicial={formulario.nombre}
      activoInicial={formulario.activo}
      cliente={formulario.tenant?.nombre ?? "—"}
      marca={formulario.marca?.nombre ?? null}
      definicionInicial={definicion.definicion}
      versionPublicada={publicada?.version ?? null}
      publicadaAt={publicada?.publicada_at ?? null}
    />
  );
}
