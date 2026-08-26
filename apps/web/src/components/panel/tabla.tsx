import { iniciales } from "@/lib/panel/iniciales";
import { cn } from "@/lib/utils";

// Las piezas de tabla del panel. Viven aquí porque las usan Usuarios y
// Clientes-marca, y una tercera copia haría que el badge de estado o el avatar
// dejaran de parecerse entre secciones sin que nadie lo note.

export const TH =
  "text-left font-semibold text-muted-foreground px-4 py-2.5 text-[11.5px]";
export const TD = "px-4 py-3 align-middle";

export function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background print:overflow-visible">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Avatar({ nombre }: { nombre: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-[30px] items-center justify-center rounded-full bg-accent text-[11.5px] font-bold text-accent-foreground"
    >
      {iniciales(nombre)}
    </span>
  );
}

/**
 * La píldora de estado del panel: forma y peso iguales en todas las secciones.
 * El COLOR lo decide quien la usa, porque el vocabulario cambia (activo/inactivo,
 * el estado de una visita, el de una solicitud); lo que no puede cambiar es el
 * tamaño ni la tipografía, o los estados dejan de parecerse entre pantallas.
 *
 * Lleva siempre texto dentro: el color nunca es el único portador del significado
 * (WCAG 1.4.1).
 */
export function Pastilla({
  tono,
  children,
}: {
  tono: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-bold",
        tono,
      )}
    >
      {children}
    </span>
  );
}

export function Estado({ activo }: { activo: boolean }) {
  return activo ? (
    <Pastilla tono="bg-completado-suave text-completado-texto">Activo</Pastilla>
  ) : (
    <Pastilla tono="bg-alerta-suave text-alerta-texto">Inactivo</Pastilla>
  );
}

/** El estado vacío y el de error de una tabla: mismo hueco, mismo peso visual. */
export function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
