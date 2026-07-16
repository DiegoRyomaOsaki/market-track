// Placeholder por rol: saluda y muestra el usuario autenticado. El shell real del
// panel (sidebar, navegación) llega en su ticket; esto solo prueba que la sesión
// y el enrutado por rol funcionan de punta a punta.
export function SaludoSesion({
  titulo,
  email,
}: {
  titulo: string;
  email: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 p-8">
      <h1 className="text-2xl font-semibold">{titulo}</h1>
      <p className="text-muted-foreground">
        Sesión iniciada como{" "}
        <span className="font-medium text-foreground">{email ?? "—"}</span>
      </p>
    </main>
  );
}
