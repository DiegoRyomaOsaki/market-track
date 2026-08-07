import { Aviso } from "@/components/panel/tabla";
import { datosDeAcceso } from "@/lib/panel/acceso-datos";

import { BitacoraPases } from "./bitacora-pases";
import { EmitirPase } from "./emitir-pase";
import { FormCanalesOtp } from "./form-canales-otp";

// La pantalla de acceso y segundo factor, compartida por admin y supervisor.
//
// Es la misma pantalla porque los dos hacen lo mismo: emitir un pase y mirar la
// bitácora. Lo que cambia —a quién puede emitírselo y qué pases ve— NO lo decide
// esta plantilla: lo decide la RLS. Si lo decidiera aquí, habría dos reglas de
// acceso que podrían desincronizarse, y la de la UI no protege nada.
//
// El admin además fija la política de canales de OTP; a los demás ni se les
// ofrece, porque su `update` moriría en la RLS.

export async function PantallaAcceso({ esAdmin }: { esAdmin: boolean }) {
  const { canales, pases, elegibles, error } = await datosDeAcceso();

  if (error !== null) return <Aviso>{error}</Aviso>;

  return (
    <div className="flex flex-col gap-6">
      {esAdmin ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
          <div>
            <h2 className="text-[13px] font-bold">Segundo factor</h2>
            <p className="text-[11.5px] text-muted-foreground">
              Política única para toda la plataforma. No se configura por
              cliente: el equipo de Market Track no pertenece a ninguno.
            </p>
          </div>
          <FormCanalesOtp habilitados={canales} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <div>
          <h2 className="text-[13px] font-bold">Pase de acceso temporal</h2>
          <p className="text-[11.5px] text-muted-foreground">
            Para el mercaderista que no recibe su código y está en tienda. Quien
            emite un pase da acceso a esa cuenta: queda registrado a su nombre.
          </p>
        </div>
        <EmitirPase usuarios={elegibles} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-bold">Bitácora de pases</h2>
        <BitacoraPases pases={pases} />
      </section>
    </div>
  );
}
