import { cerrarSesion } from "@/lib/sesion/acciones";
import { iniciales } from "@/lib/panel/iniciales";

// El bloque de identidad del pie de la barra lateral, con su salida.
//
// Vive aquí y no en `panel/` ni en `portal/` porque el markup era EXACTAMENTE el
// mismo en los dos, salvo la segunda línea. Consolidarlo no es higiene: es la
// única forma de implementar el botón de salir una vez en vez de dos, y de que
// no aparezca una tercera copia que se olvide de tenerlo.
//
// Server Component a propósito. El `<form action={...}>` con una Server Action
// no necesita `"use client"`: React lo hidrata solo, y sin JS hace un POST nativo
// que responde con la redirección. Así la barra lateral sigue siendo servidor
// entera y se esquiva de paso la trampa del empaquetado que este repo ya pisó —
// una Server Action importada desde un componente cliente arrastra su grafo al
// bundle, y eso solo lo ve `next build`.

export function BloqueUsuario({
  nombre,
  detalle,
}: {
  nombre: string;
  /** La segunda línea: el rol en el panel, el cliente-marca en el portal. */
  detalle: string;
}) {
  return (
    <div className="border-t border-border p-3">
      <div className="flex items-center gap-2.5 rounded-lg bg-muted px-2.5 py-2">
        <div
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-accent-foreground"
        >
          {iniciales(nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold">{nombre}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {detalle}
          </div>
        </div>
      </div>

      <form action={cerrarSesion}>
        <button
          type="submit"
          className="mt-2 min-h-11 w-full rounded-lg border border-border px-3 text-[12px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
