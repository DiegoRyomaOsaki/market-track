"use client";

import { useRef, useState, useTransition } from "react";

import { publicarEscaleraBonoSchema } from "@market-track/shared";

import { campo, Errores, etiqueta } from "@/components/panel/campos";
import { botonPrimario } from "@/components/panel/estilos";
import { publicarEscaleraBono } from "@/lib/metricas/acciones";
import type { NivelBono } from "@/lib/metricas/datos";
import { NOTA_PUBLICAR } from "@/lib/metricas/textos";

// La escalera de bonos: "desde este puntaje, este monto".
//
// Se publica ENTERA y de una vez, no peldaño a peldaño: la escalera vigente es
// el conjunto de la fecha más reciente, así que publicar media dejaría media
// escalera en vigor. La base lo impone; aquí solo se refleja.

type Peldano = { nombre: string; puntaje_min: string; monto: string };

const PELDANO_VACIO: Peldano = { nombre: "", puntaje_min: "", monto: "" };
const TOPE_NIVELES = 10;

export function EditorEscalera({
  tenantId,
  vigente,
  soloLectura,
  hoy,
}: {
  tenantId: string;
  vigente: NivelBono[];
  soloLectura: boolean;
  /** El día de Lima, resuelto en el servidor: `new Date()` aquí daría el del navegador. */
  hoy: string;
}) {
  const [peldanos, setPeldanos] = useState<Peldano[]>(() =>
    vigente.length > 0
      ? vigente.map((n) => ({
          nombre: n.nombre,
          puntaje_min: String(n.puntaje_min),
          monto: String(n.monto),
        }))
      : [{ ...PELDANO_VACIO }],
  );
  const [vigenteDesde, setVigenteDesde] = useState(hoy);
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [publicado, setPublicado] = useState("");
  const primerNombre = useRef<HTMLInputElement>(null);
  const resultado = useRef<HTMLParagraphElement>(null);

  function editar(i: number, cambio: Partial<Peldano>) {
    setPeldanos((prev) =>
      prev.map((p, j) => (j === i ? { ...p, ...cambio } : p)),
    );
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPublicado("");

    const datos = {
      tenant_id: tenantId,
      vigente_desde: vigenteDesde,
      niveles: peldanos.map((p) => ({
        nombre: p.nombre,
        puntaje_min: Number(p.puntaje_min),
        monto: Number(p.monto),
      })),
    };
    // Se valida ANTES de enviar para que el error diga qué corregir en vez de
    // devolver un fallo genérico del servidor.
    const parsed = publicarEscaleraBonoSchema.safeParse(datos);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa los campos");
      primerNombre.current?.focus();
      return;
    }

    arrancar(async () => {
      const r = await publicarEscaleraBono(parsed.data);
      if (r.ok) {
        setPublicado("Escalera publicada");
        resultado.current?.focus();
      } else {
        setError(r.error);
        primerNombre.current?.focus();
      }
    });
  }

  if (soloLectura) {
    return (
      <div className="flex flex-col gap-2">
        {vigente.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Este cliente todavía no tiene escalera de bonos.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {vigente.map((n) => (
              <li key={n.id} className="text-[13px]">
                <strong>{n.nombre}</strong>
                <span className="text-muted-foreground">
                  {` — desde ${n.puntaje_min} puntos: S/ ${n.monto}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {peldanos.map((p, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className={etiqueta}>Nivel</span>
              <input
                ref={i === 0 ? primerNombre : undefined}
                value={p.nombre}
                onChange={(e) => editar(i, { nombre: e.target.value })}
                placeholder="Bronce"
                className={campo}
              />
            </label>
            <label className="flex w-32 flex-col gap-1">
              <span className={etiqueta}>Desde</span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={p.puntaje_min}
                onChange={(e) => editar(i, { puntaje_min: e.target.value })}
                className={campo}
              />
            </label>
            <label className="flex w-36 flex-col gap-1">
              <span className={etiqueta}>Bono (S/)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={p.monto}
                onChange={(e) => editar(i, { monto: e.target.value })}
                className={campo}
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setPeldanos((prev) => prev.filter((_, j) => j !== i))
              }
              disabled={peldanos.length === 1}
              aria-label={`Quitar el nivel ${p.nombre.trim() || i + 1}`}
              className="flex size-[38px] items-center justify-center rounded-[9px] border border-border bg-background hover:bg-muted disabled:opacity-40"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setPeldanos((prev) => [...prev, { ...PELDANO_VACIO }])}
        disabled={peldanos.length >= TOPE_NIVELES}
        className="self-start rounded-[9px] border border-border bg-background px-3 py-1.5 text-[12.5px] font-semibold hover:bg-muted disabled:opacity-40"
      >
        + Añadir nivel
      </button>

      <label className="flex w-48 flex-col gap-1">
        <span className={etiqueta}>Vigente desde</span>
        <input
          type="date"
          value={vigenteDesde}
          onChange={(e) => setVigenteDesde(e.target.value)}
          className={campo}
        />
      </label>

      <p className="text-[11.5px] text-muted-foreground">{NOTA_PUBLICAR}</p>

      <Errores error={error} />
      <p
        aria-live="polite"
        className="text-[12.5px] font-semibold empty:hidden"
      >
        {publicado}
      </p>

      <button
        type="submit"
        disabled={pendiente}
        className={`${botonPrimario} self-start disabled:opacity-60`}
      >
        {pendiente ? "Publicando…" : "Publicar escalera"}
      </button>
    </form>
  );
}
