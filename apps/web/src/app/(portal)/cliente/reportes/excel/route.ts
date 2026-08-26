import { construirXlsx } from "@/lib/importacion/xlsx";
import { modulosDelCliente } from "@/lib/portal/estado-modulos";
import {
  armarReporte,
  filasDelReporte,
  nombreDeArchivo,
  reporteQuerySchema,
} from "@/lib/portal/reportes";
import { sesionDeCliente } from "@/lib/portal/sesion";

// La descarga del reporte en Excel.
//
// Route handler y no server action por lo mismo que la plantilla del maestro
// comercial: el navegador ya sabe descargar un GET. Un `<a download>` no
// necesita JavaScript, ni mantener el binario en memoria del cliente, ni un
// estado de "generando…".
//
// Y como es un endpoint por sí mismo, los gates viven AQUÍ: que el enlace solo
// se pinte dentro de `/cliente` no protege nada.

const TIPO_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** El SDK no trae plazo propio y su default de red pasa de los 30 s: sin techo,
 *  una conexión colgada se come el presupuesto de la función entera. */
const PLAZO_MS = 10_000;

export async function GET(peticion: Request): Promise<Response> {
  const sesion = await sesionDeCliente();
  if (sesion === null) return new Response("No autorizado", { status: 403 });

  // 404 y no 403 con el módulo apagado: es el mismo resultado que da la página
  // (`requerirModulo`), y un 403 confirmaría que la sección existe pero no se
  // contrató.
  const modulos = await modulosDelCliente();
  if (!modulos.reportes) return new Response("No encontrado", { status: 404 });

  const busqueda = new URL(peticion.url).searchParams;

  // Los valores van CRUDOS al schema, sin pasar por `leerFiltros`.
  //
  // `leerFiltros` descarta un id malformado convirtiéndolo en `null`, que para
  // el dashboard es UX razonable. Aquí sería otra cosa: quien pidió una cadena
  // concreta se descargaría TODAS sin enterarse. Un sanitizador no puede borrar
  // la distinción que decide su llamador — "no vino" y "vino mal" tienen que
  // llegar distintos a quien elige entre exportar y rechazar.
  //
  // `getAll` para `kpi` y no `Object.fromEntries`: este último colapsa los
  // valores repetidos y se queda con el último, así que `?kpi=sos&kpi=precio`
  // perdería `sos` en silencio y el Excel saldría con un indicador menos que la
  // vista previa.
  const kpiCrudo = busqueda.getAll("kpi");

  const query = reporteQuerySchema.safeParse({
    desde: busqueda.get("desde"),
    hasta: busqueda.get("hasta"),
    cadena: busqueda.get("cadena"),
    tienda: busqueda.get("tienda"),
    kpi: kpiCrudo.length > 0 ? kpiCrudo : null,
  });
  if (!query.success) {
    // Un mensaje corto y propio. Nunca el error crudo del validador ni del
    // driver: pueden arrastrar contenido de la respuesta al cuerpo HTTP.
    return new Response("Parámetros inválidos", { status: 400 });
  }

  // El periodo sale de lo YA VALIDADO, no de los filtros crudos: el endpoint
  // exige las dos fechas a propósito, porque exportar un periodo por defecto que
  // el usuario no vio en pantalla es justo la divergencia que este diseño evita.
  const periodo = { desde: query.data.desde, hasta: query.data.hasta };

  const { data, error } = await sesion.supabase
    .rpc("dashboard_kpis", {
      p_desde: query.data.desde,
      p_hasta: query.data.hasta,
      p_cadena: query.data.cadena ?? undefined,
      p_tienda: query.data.tienda ?? undefined,
    })
    .abortSignal(AbortSignal.timeout(PLAZO_MS));

  if (error) {
    console.error(
      JSON.stringify({
        evento: "reporte_excel_error",
        detalle: error.message.slice(0, 200),
      }),
    );
    return new Response("No se pudo generar el reporte", { status: 502 });
  }

  const reporte = armarReporte(data?.[0] ?? null, query.data.kpi, periodo);
  const filas = filasDelReporte(reporte);

  console.info(
    JSON.stringify({
      evento: "reporte_excel",
      desde: periodo.desde,
      hasta: periodo.hasta,
      cadena: query.data.cadena,
      tienda: query.data.tienda,
      indicadores: reporte.filas.length,
    }),
  );

  const libro = construirXlsx([
    {
      nombre: "Resumen",
      filas: [
        [`Reporte del ${periodo.desde} al ${periodo.hasta}`],
        [],
        ...filas,
      ],
    },
  ]);

  return new Response(new Uint8Array(libro), {
    headers: {
      "Content-Type": TIPO_XLSX,
      "Content-Disposition": `attachment; filename="${nombreDeArchivo(periodo)}"`,
      // Lleva datos del tenant: cachearlo en un intermediario es un cruce de
      // clientes esperando a ocurrir.
      "Cache-Control": "no-store",
    },
  });
}
