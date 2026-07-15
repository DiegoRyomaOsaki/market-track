import { redirect } from "next/navigation";

// Aún no hay landing ni un destino por rol: la raíz manda al login. El aterrizaje
// por rol tras iniciar sesión llega con el shell del panel.
export default function Home() {
  redirect("/login");
}
