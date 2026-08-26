// El estado de carga de Reportes.
//
// La página espera dos llamadas a Supabase con un techo de 10 s, y sin esto el
// navegador se queda en la pantalla anterior todo ese rato: una ventana muerta
// que se lee como un clic ignorado y que invita a volver a pulsar.
//
// El resto del portal todavía no tiene el suyo; esta ruta es la primera. Ampliarlo
// a las demás secciones es un cambio transversal, no incidental a este ticket.
export default function CargandoReportes() {
  return (
    <div className="px-6 py-5" aria-busy="true">
      <p className="text-sm text-muted-foreground">Armando tu reporte…</p>
    </div>
  );
}
