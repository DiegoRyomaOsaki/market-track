// Marcador de sección aún sin construir. Da a la navegación del shell un destino
// real mientras cada pantalla llega en su ticket.
export function SeccionPlaceholder({ titulo }: { titulo: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background p-10 text-center">
      <div className="text-lg font-semibold">{titulo}</div>
      <p className="max-w-md text-sm text-muted-foreground">
        Esta sección todavía no está implementada.
      </p>
    </div>
  );
}
