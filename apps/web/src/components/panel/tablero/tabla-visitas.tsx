import { Avatar, Aviso, Tarjeta, TD, TH } from "@/components/panel/tabla";
import {
  colorDeVisita,
  formatoDuracion,
  textoDeVisita,
  type FilaTablero,
} from "@/lib/panel/tablero";
import { cn } from "@/lib/utils";

// La tabla de visitas del día. Recibe filas ya listas: los campos derivados
// (duración, fotos, motivo) los calculó `tablero_dia` en la base.

const ESTILO_ESTADO = {
  verde: "bg-completado-suave text-completado-texto",
  ambar: "bg-en-curso-suave text-en-curso-texto",
  rojo: "bg-alerta-suave text-alerta-texto",
} as const;

function hora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Lima",
  });
}

function numero(valor: number | null, sufijo: string): string {
  return valor === null ? "—" : `${valor}${sufijo}`;
}

export function TablaVisitas({ filas }: { filas: FilaTablero[] }) {
  if (filas.length === 0) {
    return <Aviso>Todavía no hay visitas registradas hoy.</Aviso>;
  }

  return (
    <Tarjeta>
      <caption className="sr-only">
        Visitas del día con su estado, duración y evidencia
      </caption>
      <thead className="border-b border-border">
        <tr>
          <th className={TH}>Mercaderista</th>
          <th className={TH}>DNI</th>
          <th className={TH}>Punto de venta</th>
          <th className={TH}>Entrada</th>
          <th className={TH}>Salida</th>
          <th className={TH}>Duración</th>
          <th className={TH}>Traslado</th>
          <th className={TH}>Batería</th>
          <th className={TH}>Fotos</th>
          <th className={TH}>Estado</th>
          <th className={TH}>Motivo</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {filas.map((f) => (
          <tr key={f.visita_id}>
            <td className={TD}>
              <span className="flex items-center gap-2">
                <Avatar nombre={f.mercaderista_nombre} />
                <span className="font-semibold">{f.mercaderista_nombre}</span>
              </span>
            </td>
            <td className={cn(TD, "tabular-nums text-muted-foreground")}>
              {f.mercaderista_dni ?? "—"}
            </td>
            <td className={TD}>{f.tienda_nombre}</td>
            <td className={cn(TD, "tabular-nums")}>{hora(f.check_in_at)}</td>
            <td className={cn(TD, "tabular-nums")}>{hora(f.check_out_at)}</td>
            <td className={cn(TD, "tabular-nums")}>
              {formatoDuracion(f.duracion_min)}
            </td>
            <td className={cn(TD, "tabular-nums")}>
              {numero(f.tiempo_traslado_min, " min")}
            </td>
            <td className={cn(TD, "tabular-nums")}>
              {numero(f.bateria_inicio_pct, " %")}
            </td>
            <td className={cn(TD, "tabular-nums")}>{f.fotos}</td>
            <td className={TD}>
              {/* El color no puede ser el único portador del estado (WCAG 1.4.1):
                  el texto va dentro del badge, no solo en el tono. */}
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-bold",
                  ESTILO_ESTADO[colorDeVisita(f.estado)],
                )}
              >
                {textoDeVisita(f.estado)}
              </span>
            </td>
            <td className={cn(TD, "max-w-[220px] text-muted-foreground")}>
              {f.motivo ? (
                <span className="line-clamp-2">{f.motivo}</span>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}
