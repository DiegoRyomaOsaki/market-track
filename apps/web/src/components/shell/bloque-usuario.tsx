import { cerrarSesion } from "@/lib/sesion/acciones";
import { iniciales } from "@/lib/panel/iniciales";

import { BotonSalir } from "./boton-salir";

// El bloque de identidad del pie de la barra lateral, con su salida.
//
// Vive aquí y no en `panel/` ni en `portal/` porque el markup era EXACTAMENTE el
// mismo en los dos, salvo la segunda línea. Consolidarlo no es higiene: es la
// única forma de implementar el botón de salir una vez en vez de dos, y de que
// no aparezca una tercera copia que se olvide de tenerlo.
//
// Server Component. El `<form action={...}>` con una Server Action no necesita
// `"use client"`: React lo hidrata solo, y sin JS hace un POST nativo que
// responde con la redirección — el botón sigue cerrando la sesión sin JavaScript.
//
// La única hoja cliente es `<BotonSalir />`, y solo por el estado de envío: el
// cierre puede tardar hasta 8 s con el Auth server lento, y una ventana muerta se
// lee como un clic ignorado. El borde de cliente se queda en esa hoja, que es lo
// que además mantiene la Server Action fuera del empaquetado del navegador.

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

      {/* El botón es la única hoja cliente, y solo por el estado de envío. La
          acción la importa ESTE componente, que es servidor: si la importara la
          hoja, arrastraría su grafo al empaquetado. */}
      <form action={cerrarSesion}>
        <BotonSalir />
      </form>
    </div>
  );
}
