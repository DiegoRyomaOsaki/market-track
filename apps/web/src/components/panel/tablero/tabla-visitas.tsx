import {
  Avatar,
  Aviso,
  Pastilla,
  Tarjeta,
  TD,
  TH,
} from "@/components/panel/tabla";
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
          <th scope="col" className={TH}>
            Mercaderista
          </th>
          <th scope="col" className={TH}>
            DNI
          </th>
          <th scope="col" className={TH}>
            Punto de venta
          </th>
          <th scope="col" className={TH}>
            Entrada
          </th>
          <th scope="col" className={TH}>
            Salida
          </th>
          <th scope="col" className={TH}>
            Duración
          </th>
          <th scope="col" className={TH}>
            Traslado
          </th>
          <th scope="col" className={TH}>
            Batería
          </th>
          <th scope="col" className={TH}>
            Fotos
          </th>
          <th scope="col" className={TH}>
            Estado
          </th>
          <th scope="col" className={TH}>
            Motivo
          </th>
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
              <Pastilla tono={ESTILO_ESTADO[colorDeVisita(f.estado)]}>
                {textoDeVisita(f.estado)}
              </Pastilla>
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
