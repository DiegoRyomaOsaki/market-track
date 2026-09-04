"use client";

import { useState, useTransition } from "react";

import { CANALES_OTP, type CanalOtp } from "@market-track/shared";

import {
  AVISO_CANALES_SIN_ENTREGA,
  CANAL_OBLIGATORIO,
  canalesConCorreo,
  ETIQUETA_CANAL,
} from "@/lib/panel/acceso";
import { guardarCanalesOtp } from "@/lib/panel/acciones-acceso";

// Los canales por los que puede llegar el código de segundo factor.
//
// Es política de LA OUTSOURCING, no de cada cliente: el staff no pertenece a
// ninguno y el 2FA es una sola regla para toda la plataforma.

export function FormCanalesOtp({ habilitados }: { habilitados: CanalOtp[] }) {
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState("");

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    // Un checkbox `disabled` NO viaja en el FormData, así que el correo no
    // aparecería aquí aunque se vea marcado. Se manda lo que la pantalla enseña,
    // sin depender de que la acción lo arregle después.
    const canales = canalesConCorreo(
      CANALES_OTP.filter((c) => datos.get(c) !== null),
    );

    setError(null);
    setGuardado("");
    arrancar(async () => {
      const r = await guardarCanalesOtp({ canales });
      if (r.ok) setGuardado("Política de acceso guardada");
      else setError(r.error);
    });
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[12px] font-semibold">
          Canales habilitados
        </legend>
        {CANALES_OTP.map((canal) => {
          const esObligatorio = canal === CANAL_OBLIGATORIO;
          return (
            <label key={canal} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name={canal}
                defaultChecked={esObligatorio || habilitados.includes(canal)}
                // El correo no se desactiva. Quien lo impone de verdad es un
                // CHECK de la base; esto solo evita ofrecer un clic que fallaría.
                disabled={esObligatorio}
                className="size-4"
              />
              <span>{ETIQUETA_CANAL[canal]}</span>
              {esObligatorio ? (
                <span className="text-[11.5px] text-muted-foreground">
                  — siempre activo: es el único canal que entrega hoy
                </span>
              ) : null}
            </label>
          );
        })}
      </fieldset>

      <p className="rounded-lg bg-muted p-3 text-[11.5px] text-muted-foreground">
        {AVISO_CANALES_SIN_ENTREGA}
      </p>

      <button
        type="submit"
        disabled={pendiente}
        className="min-h-11 self-start rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pendiente ? "Guardando…" : "Guardar política"}
      </button>

      <p role="alert" className="text-[12px] text-alerta-texto empty:hidden">
        {error ?? ""}
      </p>
      <p
        role="status"
        className="text-[12px] text-completado-texto empty:hidden"
      >
        {guardado}
      </p>
    </form>
  );
}
