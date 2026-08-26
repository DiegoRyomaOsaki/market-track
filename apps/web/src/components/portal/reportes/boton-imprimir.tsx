"use client";

// La hoja de cliente más pequeña posible: un botón que llama a `window.print()`.
//
// El PDF lo genera el navegador desde ESTA misma vista previa, así que la
// previsualización y el archivo son el mismo artefacto y no pueden divergir. Una
// librería de PDF en el servidor sería un segundo renderizador que se separa del
// HTML con el tiempo, y en silencio.
//
// Un `<button>` de verdad: el teclado funciona sin hacer nada. Y sin estado de
// carga porque no hay trabajo asíncrono — el diálogo lo abre el navegador.

export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-border px-4 py-2 text-[13px] font-semibold"
    >
      Descargar PDF
    </button>
  );
}
