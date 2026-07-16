import { iniciales } from "@/lib/panel/iniciales";

// Las piezas de tabla del panel. Viven aquí porque las usan Usuarios y
// Clientes-marca, y una tercera copia haría que el badge de estado o el avatar
// dejaran de parecerse entre secciones sin que nadie lo note.

export const TH =
  "text-left font-semibold text-muted-foreground px-4 py-2.5 text-[11.5px]";
export const TD = "px-4 py-3 align-middle";

export function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background">
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

export function Estado({ activo }: { activo: boolean }) {
  return activo ? (
    <span className="inline-flex rounded-full bg-completado-suave px-2.5 py-0.5 text-[11.5px] font-bold text-completado-texto">
      Activo
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-alerta-suave px-2.5 py-0.5 text-[11.5px] font-bold text-alerta-texto">
      Inactivo
    </span>
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
