import type { ErrorImportacion } from "@market-track/shared";

import { Tarjeta, TD, TH } from "@/components/panel/tabla";

// Los errores del archivo, fila por fila.
//
// La columna que de verdad importa es "Fila": es el número que el operador ve en
// su Excel, así que puede ir a corregirlo sin traducir nada. Por eso la hoja y la
// fila van primero y el mensaje al final.

export function TablaErrores({
  errores,
  omitidos,
}: {
  errores: ErrorImportacion[];
  omitidos: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Tarjeta>
        <thead>
          <tr className="border-b border-border">
            <th className={TH}>Hoja</th>
            <th className={TH}>Fila</th>
            <th className={TH}>Columna</th>
            <th className={TH}>Valor</th>
            <th className={TH}>Qué pasa</th>
          </tr>
        </thead>
        <tbody>
          {errores.map((e, i) => (
            <tr
              // La misma celda puede fallar dos veces por motivos distintos, así
              // que la clave lleva también el índice: hoja+fila+columna no es
              // única.
              key={`${e.hoja}-${e.fila}-${e.columna ?? ""}-${i}`}
              className="border-b border-border last:border-0"
            >
              <td className={TD}>{e.hoja}</td>
              <td className={`${TD} tabular-nums font-semibold`}>{e.fila}</td>
              <td className={TD}>{e.columna ?? "—"}</td>
              <td className={`${TD} text-muted-foreground`}>
                {e.valor === null || e.valor === "" ? "(vacío)" : e.valor}
              </td>
              <td className={TD}>{e.mensaje}</td>
            </tr>
          ))}
        </tbody>
      </Tarjeta>

      {omitidos > 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          Hay {omitidos} error{omitidos === 1 ? "" : "es"} más que no se
          muestran. Corrige estos y vuelve a previsualizar.
        </p>
      )}
    </div>
  );
}
