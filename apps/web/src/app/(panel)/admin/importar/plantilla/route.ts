import {
  construirPlantilla,
  NOMBRE_PLANTILLA,
} from "@/lib/importacion/plantilla-archivo";
import { sesionDeStaff } from "@/lib/panel/sesion";

// La descarga de la plantilla del maestro comercial.
//
// Es un route handler y no una server action porque el navegador ya sabe
// descargar un GET: un `<a download>` no necesita JavaScript, ni mantener el
// binario en memoria del cliente, ni un estado de "generando…".
//
// Va detrás del mismo gate que el importador: el middleware ya protege `/admin`,
// pero un route handler es un endpoint por sí mismo y la comprobación de rol vive
// aquí, no en el enlace que lo apunta.

const TIPO_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(): Promise<Response> {
  const sesion = await sesionDeStaff();
  if (sesion === null || sesion.perfil.rol !== "admin") {
    return new Response("No autorizado", { status: 403 });
  }

  return new Response(new Uint8Array(construirPlantilla()), {
    headers: {
      "Content-Type": TIPO_XLSX,
      "Content-Disposition": `attachment; filename="${NOMBRE_PLANTILLA}"`,
      // Se genera en cada petición desde `COLUMNAS`: cachearla es exactamente el
      // desfase que la generación evita.
      "Cache-Control": "no-store",
    },
  });
}
