import { Aviso } from "@/components/panel/tabla";
import { tenantActivo } from "@/lib/panel/tenant-activo";

import { SubirMaestro } from "./subir-maestro";

// La pantalla de importación del maestro comercial.
//
// Server Component: resuelve CONTRA QUÉ CLIENTE se va a importar antes de pintar
// nada. Es el dato más importante de esta pantalla — una importación aplicada al
// cliente equivocado le mete a Oster el catálogo de otra marca — así que se
// enseña en grande, no se deduce del selector del header.

export async function PantallaImportar() {
  const tenant = await tenantActivo();

  if (tenant === null) {
    return (
      <Aviso>
        No hay ningún cliente-marca activo al que importar un maestro.
      </Aviso>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
        <h2 className="text-[13px] font-bold">1 · Descarga la plantilla</h2>
        <p className="text-[11.5px] text-muted-foreground">
          Una hoja por entidad —marca, cadena, sku, tienda, tienda_sku,
          precio_regular, promocion— con sus columnas. No cambies los nombres de
          las hojas ni de las cabeceras: el importador las busca por nombre.
        </p>
        <a
          href="/admin/importar/plantilla"
          download
          className="min-h-11 self-start rounded-lg border border-border px-4 py-2.5 text-[13px] font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Descargar plantilla (.xlsx)
        </a>
      </section>

      <SubirMaestro tenantId={tenant.id} tenantNombre={tenant.nombre} />
    </div>
  );
}
