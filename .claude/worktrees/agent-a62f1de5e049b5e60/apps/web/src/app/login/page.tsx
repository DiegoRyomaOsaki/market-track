import type { Metadata } from "next";

import { FormLogin } from "@/components/login/form-login";
import { rutaSegura } from "@/lib/authz";

export const metadata: Metadata = { title: "Iniciar sesión — Market Track" };

function primero(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirect?: string | string[];
    paso?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // El destino viene del query: solo se acepta si es una ruta de este sitio.
  const destino = rutaSegura(primero(params.redirect));
  // El middleware manda aquí con ?paso=2fa a quien ya tiene sesión pero le falta
  // el segundo factor: en ese caso no hay que volver a pedir la contraseña.
  const empiezaEn2fa = primero(params.paso) === "2fa";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex items-center gap-2.5">
        <div
          aria-hidden="true"
          className="flex size-[30px] items-center justify-center rounded-lg bg-primary text-[15px] font-extrabold text-primary-foreground"
        >
          M
        </div>
        <div>
          <div className="text-[15px] font-extrabold tracking-tight">
            Market Track
          </div>
          <div className="text-[11px] font-medium text-muted-foreground">
            Panel de gestión
          </div>
        </div>
      </div>

      <FormLogin destino={destino} empiezaEn2fa={empiezaEn2fa} />
    </main>
  );
}
