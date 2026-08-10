"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { AVISO_CANJE_PENDIENTE } from "@/lib/panel/acceso";
import { emitirPase } from "@/lib/panel/acciones-acceso";

import { CodigoPase } from "./codigo-pase";

// Emitir un pase de acceso temporal. Es dar acceso a la cuenta de otra persona,
// así que el motivo es obligatorio: es lo único que la bitácora podrá responder
// cuando alguien pregunte por qué.

export type UsuarioElegible = {
  id: string;
  nombre: string;
  dni: string | null;
};

export function EmitirPase({ usuarios }: { usuarios: UsuarioElegible[] }) {
  const router = useRouter();
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [emitido, setEmitido] = useState<{
    codigo: string;
    expiraAt: string;
  } | null>(null);
  const motivoRef = useRef<HTMLTextAreaElement>(null);

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    // `FormData.get` puede devolver un File: lo que no sea texto no es un campo
    // de este formulario.
    const texto = (campo: string) => {
      const v = datos.get(campo);
      return typeof v === "string" ? v : "";
    };
    const motivo = texto("motivo").trim();
    const profileId = texto("usuario");

    if (motivo === "") {
      setError("Explica por qué se emite este pase");
      motivoRef.current?.focus();
      return;
    }

    setError(null);
    arrancar(async () => {
      const r = await emitirPase({ profileId, motivo });
      if (r.ok) {
        setEmitido({ codigo: r.codigo, expiraAt: r.expiraAt });
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }

  if (usuarios.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No hay mercaderistas activos a los que emitir un pase.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={enviar} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold">Mercaderista</span>
          <select
            name="usuario"
            className="min-h-11 rounded-lg border border-border bg-background px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
                {u.dni === null ? "" : ` · ${u.dni}`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold">
            Motivo <span className="text-muted-foreground">(obligatorio)</span>
          </span>
          <textarea
            ref={motivoRef}
            name="motivo"
            rows={2}
            maxLength={500}
            placeholder="Por ejemplo: no le llega el correo con el código y está en tienda"
            className="rounded-lg border border-border bg-background p-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>

        {/* El código se enseña una sola vez: si el operador no está listo para
            dictarlo, más vale que lo sepa ANTES de pulsar. */}
        <p className="text-[11.5px] text-muted-foreground">
          El código aparece una sola vez y vence a los 15 minutos.{" "}
          {AVISO_CANJE_PENDIENTE}
        </p>

        <button
          type="submit"
          disabled={pendiente}
          className="min-h-11 self-start rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pendiente ? "Generando…" : "Generar pase de acceso"}
        </button>
      </form>

      {/* La región se monta siempre y solo cambia su texto: un `role="alert"`
          que aparece al fallar se lo pierden algunos lectores de pantalla. */}
      <p role="alert" className="text-[12px] text-alerta-texto empty:hidden">
        {error ?? ""}
      </p>

      {emitido === null ? null : (
        <CodigoPase
          codigo={emitido.codigo}
          expiraAt={emitido.expiraAt}
          alVencer={() => router.refresh()}
        />
      )}
    </div>
  );
}
