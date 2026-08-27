import { ETIQUETAS_KPI } from "@/lib/portal/dashboard";
import type { FiltrosGlobales } from "@/lib/portal/filtros";
import { CLAVES_KPI, type ClaveKpi } from "@/lib/portal/reportes";

// El configurador del reporte: qué indicadores entran.
//
// Es un `<form method="get">` sin una línea de JavaScript. El navegador ya sabe
// serializar un formulario GET a la misma URL de la que salen los filtros
// globales, así que el estado sigue viviendo donde vive el del resto del portal
// —en la dirección— y el reporte se comparte por enlace tal y como se configuró.
//
// Los filtros globales viajan en `<input type="hidden">`. Sin ellos, enviar este
// formulario los borraría de la URL y la vista previa cambiaría de periodo al
// tocar un indicador: se exportaría algo distinto de lo que se vio.

export function Configurador({
  filtros,
  seleccion,
}: {
  filtros: FiltrosGlobales;
  seleccion: ClaveKpi[] | null;
}) {
  const elegidos = new Set<string>(seleccion ?? CLAVES_KPI);

  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-background px-5 py-4 print:hidden"
    >
      {filtros.desde ? (
        <input type="hidden" name="desde" value={filtros.desde} />
      ) : null}
      {filtros.hasta ? (
        <input type="hidden" name="hasta" value={filtros.hasta} />
      ) : null}
      {filtros.cadena ? (
        <input type="hidden" name="cadena" value={filtros.cadena} />
      ) : null}
      {filtros.tienda ? (
        <input type="hidden" name="tienda" value={filtros.tienda} />
      ) : null}

      <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <legend className="mb-1 text-[11.5px] font-semibold text-muted-foreground">
          Indicadores del reporte
        </legend>
        {CLAVES_KPI.map((clave) => (
          <label
            key={clave}
            className="flex cursor-pointer items-center gap-2 text-[13px]"
          >
            <input
              type="checkbox"
              name="kpi"
              value={clave}
              defaultChecked={elegidos.has(clave)}
              className="size-4 accent-primary"
            />
            {ETIQUETAS_KPI[clave]}
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        className="rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground"
      >
        Actualizar vista previa
      </button>
    </form>
  );
}
