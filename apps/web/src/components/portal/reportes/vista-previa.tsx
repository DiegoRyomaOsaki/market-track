import { Tarjeta, TD, TH } from "@/components/panel/tabla";
import type { FiltrosGlobales } from "@/lib/portal/filtros";
import type { Reporte } from "@/lib/portal/reportes";

// La vista previa del reporte — y, al imprimirla, el PDF. Es el mismo DOM.
//
// La cabecera es CONTENIDO, no decorado: el navegador solo imprime su propio
// encabezado con la URL y la fecha si el usuario lo deja activado, así que el
// periodo y los filtros aplicados tienen que estar dentro del artefacto o el PDF
// no dice de qué habla. Es lo que hace comprobable que exporta «los datos
// filtrados» y no otros.

function textoDeFiltros(filtros: FiltrosGlobales): string | null {
  const partes: string[] = [];
  if (filtros.cadena) partes.push("una cadena");
  if (filtros.tienda) partes.push("una tienda");
  return partes.length > 0 ? `Filtrado por ${partes.join(" y ")}` : null;
}

export function VistaPrevia({
  reporte,
  filtros,
  cliente,
  generadoEl,
}: {
  reporte: Reporte;
  filtros: FiltrosGlobales;
  cliente: string;
  generadoEl: string;
}) {
  const filtrado = textoDeFiltros(filtros);

  return (
    <section className="flex flex-col gap-4 print:break-inside-avoid">
      <header className="flex flex-col gap-1">
        <h2 className="text-[17px] font-extrabold tracking-tight">
          Reporte de {cliente}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Del {reporte.periodo.desde} al {reporte.periodo.hasta}
          {filtrado ? ` · ${filtrado}` : ""}
        </p>
        <p className="text-[11.5px] text-muted-foreground">
          Generado el {generadoEl}
        </p>
      </header>

      {reporte.filas.length === 0 ? (
        <p className="rounded-xl border border-border bg-background px-5 py-6 text-[13px] text-muted-foreground">
          Sin datos en el periodo del {reporte.periodo.desde} al{" "}
          {reporte.periodo.hasta}.
        </p>
      ) : (
        <Tarjeta>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Indicador</th>
              <th className={TH}>Valor</th>
              {/* «Variación» y no una flecha: el sentido del cambio va en
                  palabras, nunca solo en un icono o un color (WCAG 1.4.1). */}
              <th className={TH}>Variación</th>
            </tr>
          </thead>
          <tbody>
            {reporte.filas.map((f) => (
              <tr
                key={f.clave}
                className="border-b border-border last:border-0"
              >
                <td className={TD}>{f.indicador}</td>
                <td className={`${TD} font-semibold`}>{f.valor}</td>
                <td className={`${TD} text-muted-foreground`}>{f.variacion}</td>
              </tr>
            ))}
          </tbody>
        </Tarjeta>
      )}
    </section>
  );
}
