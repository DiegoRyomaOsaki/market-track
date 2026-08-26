"use client";

import { useFormStatus } from "react-dom";

// La ÚNICA pieza cliente de la barra lateral, y solo por el estado de envío.
//
// `cerrarSesion` puede tardar hasta su deadline de 8 s cuando el Auth server va
// lento: sin señal, entre el clic y la redirección no pasa nada visible, y una
// ventana muerta se lee como un clic ignorado — el usuario vuelve a pulsar y
// dispara una segunda carrera.
//
// La hoja es esto y nada más. La Server Action la importa `BloqueUsuario`, que
// es servidor, y aquí NO se importa: si un componente cliente la importara,
// arrastraría su grafo entero al empaquetado, que es la trampa que este repo ya
// pisó una vez y que `next build` es lo único en cazar.

export function BotonSalir() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 min-h-11 w-full rounded-lg border border-border px-3 text-[12px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-60"
    >
      {pending ? "Cerrando sesión…" : "Cerrar sesión"}
    </button>
  );
}
