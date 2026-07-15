// Placeholder: existe para que el redirect del middleware (sesión ausente) no
// caiga en un 404. La pantalla de acceso real —con el segundo factor— llega con
// el shell del panel y del portal.
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <p className="text-muted-foreground">
        La pantalla de acceso todavía no está implementada.
      </p>
    </main>
  );
}
