"use client";

import { useRef, useState, useTransition } from "react";

import {
  altaConfigMerchandiserSchema,
  PERIODOS_PUNTAJE,
} from "@market-track/shared";

import { campo, Errores, etiqueta } from "@/components/panel/campos";
import { botonPrimario } from "@/components/panel/estilos";
import {
  previsualizarMerchandiser,
  publicarConfigMerchandiser,
} from "@/lib/metricas/acciones";
import type { ConfigMerchandiser } from "@/lib/metricas/datos";
import {
  ETIQUETA_MERCHANDISER,
  ETIQUETA_PERIODO,
  EXPLICACION_MERCHANDISER,
  NOTA_PUBLICAR,
  VACIO_VISTA_PREVIA_MERCHANDISER,
  VARIABLES_MERCHANDISER,
} from "@/lib/metricas/textos";

import { VistaPreviaPuntaje } from "./vista-previa-puntaje";

// Los pesos y la política del plan de lealtad del mercaderista.
//
// El peso del tiempo efectivo NO se edita: está fijado en 0 por un CHECK de la
// base porque la variable no tiene fórmula acordada. Se muestra deshabilitado y
// con su explicación en vez de esconderlo — un peso que desaparece de la
// pantalla es un peso que el admin no sabe que existe.

const CAMPOS_PESO = {
  puntualidad: "peso_puntualidad",
  asistencia: "peso_asistencia",
  tiempo_efectivo: "peso_tiempo_efectivo",
  calidad: "peso_calidad",
  herramientas: "peso_herramientas",
} as const;

export function FormMerchandiser({
  tenantId,
  vigente,
  soloLectura,
  hoy,
}: {
  tenantId: string;
  vigente: ConfigMerchandiser | null;
  soloLectura: boolean;
  hoy: string;
}) {
  const [pesos, setPesos] = useState<Record<string, string>>(() => ({
    peso_puntualidad: String(vigente?.peso_puntualidad ?? 25),
    peso_asistencia: String(vigente?.peso_asistencia ?? 30),
    peso_tiempo_efectivo: "0",
    peso_calidad: String(vigente?.peso_calidad ?? 25),
    peso_herramientas: String(vigente?.peso_herramientas ?? 20),
  }));
  const [tolerancia, setTolerancia] = useState(
    String(vigente?.tolerancia_puntualidad_min ?? 15),
  );
  const [tardanzaCero, setTardanzaCero] = useState(
    String(vigente?.minutos_tardanza_cero ?? 60),
  );
  const [gracia, setGracia] = useState(
    String(vigente?.dias_gracia_cierre ?? 7),
  );
  const [periodicidad, setPeriodicidad] = useState(
    vigente?.periodicidad ?? "mensual",
  );
  const [umbralSinVerificar, setUmbralSinVerificar] = useState(
    String(vigente?.umbral_fotos_sin_verificar_pct ?? 20),
  );
  const [vigenteDesde, setVigenteDesde] = useState(hoy);
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [publicado, setPublicado] = useState("");
  const primerPeso = useRef<HTMLInputElement>(null);
  const resultado = useRef<HTMLParagraphElement>(null);

  function datosActuales() {
    return {
      tenant_id: tenantId,
      peso_puntualidad: Number(pesos.peso_puntualidad),
      peso_asistencia: Number(pesos.peso_asistencia),
      peso_tiempo_efectivo: 0 as const,
      peso_calidad: Number(pesos.peso_calidad),
      peso_herramientas: Number(pesos.peso_herramientas),
      tolerancia_puntualidad_min: Number(tolerancia),
      minutos_tardanza_cero: Number(tardanzaCero),
      dias_gracia_cierre: Number(gracia),
      periodicidad,
      umbral_fotos_sin_verificar_pct: Number(umbralSinVerificar),
      vigente_desde: vigenteDesde,
    };
  }

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPublicado("");

    const parsed = altaConfigMerchandiserSchema.safeParse(datosActuales());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa los campos");
      // Al campo que hay que corregir, no al botón: quien navega con teclado no
      // tiene por qué buscar a mano dónde estaba el problema.
      primerPeso.current?.focus();
      return;
    }
    arrancar(async () => {
      const r = await publicarConfigMerchandiser(parsed.data);
      if (r.ok) {
        setPublicado("Configuración publicada");
        resultado.current?.focus();
      } else {
        setError(r.error);
        primerPeso.current?.focus();
      }
    });
  }

  const suma = VARIABLES_MERCHANDISER.reduce(
    (t, v) => t + Number(pesos[CAMPOS_PESO[v]] || 0),
    0,
  );

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3" disabled={soloLectura}>
        <legend className="text-[13px] font-bold">
          Pesos de las variables
        </legend>
        {VARIABLES_MERCHANDISER.map((v) => {
          const nombreCampo = CAMPOS_PESO[v];
          const apagada = v === "tiempo_efectivo";
          return (
            <div key={v} className="flex flex-col gap-1">
              <label className="flex flex-col gap-1">
                <span className={etiqueta}>{ETIQUETA_MERCHANDISER[v]}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  ref={v === "puntualidad" ? primerPeso : undefined}
                  value={pesos[nombreCampo]}
                  onChange={(e) =>
                    setPesos((p) => ({ ...p, [nombreCampo]: e.target.value }))
                  }
                  // La base lo fija en 0 con un CHECK: ofrecer el control sería
                  // ofrecer un clic que termina en error.
                  disabled={apagada}
                  aria-describedby={`ayuda-${v}`}
                  className={`${campo} w-40 disabled:opacity-60`}
                />
              </label>
              {/* FUERA del `label` a propósito: dentro, su texto entraría en el
                  NOMBRE accesible del campo y el lector de pantalla lo leería
                  dos veces —una como nombre, otra por `aria-describedby`—. Aquí
                  es solo la descripción, que es lo que es. */}
              <span
                id={`ayuda-${v}`}
                className="text-[11.5px] text-muted-foreground"
              >
                {EXPLICACION_MERCHANDISER[v]}
              </span>
            </div>
          );
        })}
        <p
          className={`text-[12.5px] font-semibold ${suma === 100 ? "text-muted-foreground" : "text-alerta-texto"}`}
        >
          {`Suman ${suma.toFixed(2)} de 100`}
        </p>
      </fieldset>

      <fieldset className="flex flex-wrap gap-3" disabled={soloLectura}>
        <legend className="text-[13px] font-bold">
          Política de puntualidad
        </legend>
        <label className="flex w-44 flex-col gap-1">
          <span className={etiqueta}>Tolerancia (min)</span>
          <input
            type="number"
            min={0}
            value={tolerancia}
            onChange={(e) => setTolerancia(e.target.value)}
            aria-describedby="ayuda-tolerancia"
            className={campo}
          />
          <span
            id="ayuda-tolerancia"
            className="text-[11.5px] text-muted-foreground"
          >
            Hasta estos minutos de retraso, la parada sigue puntuando 100.
          </span>
        </label>
        <label className="flex w-44 flex-col gap-1">
          <span className={etiqueta}>Tardanza que da 0 (min)</span>
          <input
            type="number"
            min={1}
            value={tardanzaCero}
            onChange={(e) => setTardanzaCero(e.target.value)}
            aria-describedby="ayuda-tardanza"
            className={campo}
          />
          <span
            id="ayuda-tardanza"
            className="text-[11.5px] text-muted-foreground"
          >
            A partir de aquí la parada no puntúa. Entre la tolerancia y este
            valor el puntaje baja en línea recta.
          </span>
        </label>
        <label className="flex w-44 flex-col gap-1">
          <span className={etiqueta}>Días de gracia</span>
          <input
            type="number"
            min={0}
            value={gracia}
            onChange={(e) => setGracia(e.target.value)}
            aria-describedby="ayuda-gracia"
            className={campo}
          />
          <span
            id="ayuda-gracia"
            className="text-[11.5px] text-muted-foreground"
          >
            Lo que se espera tras cerrar el periodo antes de congelar el
            puntaje. Cubre al teléfono que sincroniza tarde.
          </span>
        </label>
        <label className="flex w-44 flex-col gap-1">
          <span className={etiqueta}>Periodicidad</span>
          <select
            value={periodicidad}
            onChange={(e) =>
              setPeriodicidad(e.target.value as typeof periodicidad)
            }
            aria-describedby="ayuda-periodicidad"
            className={campo}
          >
            {PERIODOS_PUNTAJE.map((p) => (
              <option key={p} value={p}>
                {ETIQUETA_PERIODO[p]}
              </option>
            ))}
          </select>
          <span
            id="ayuda-periodicidad"
            className="text-[11.5px] text-muted-foreground"
          >
            Cada cuánto se cierra y se paga el plan. Es del plan entero, no de
            cada nivel de bono.
          </span>
        </label>
      </fieldset>

      <fieldset className="flex flex-wrap gap-3" disabled={soloLectura}>
        <legend className="text-[13px] font-bold">Guardarraíl de cierre</legend>
        <label className="flex w-44 flex-col gap-1">
          <span className={etiqueta}>Umbral de fotos sin verificar</span>
          <input
            type="number"
            min={0}
            max={100}
            value={umbralSinVerificar}
            onChange={(e) => setUmbralSinVerificar(e.target.value)}
            aria-describedby="ayuda-umbral-verificacion"
            className={campo}
          />
          <span
            id="ayuda-umbral-verificacion"
            className="text-[11.5px] text-muted-foreground"
          >
            Porcentaje de fotos subidas y sin sellar por el servidor a partir del
            cual el periodo no se cierra. Evita pagar el bono sobre evidencia que
            no terminó de guardarse.
          </span>
        </label>
      </fieldset>

      <VistaPreviaPuntaje
        onCalcular={() =>
          previsualizarMerchandiser(tenantId, {
            peso_puntualidad: Number(pesos.peso_puntualidad),
            peso_asistencia: Number(pesos.peso_asistencia),
            peso_tiempo_efectivo: 0,
            peso_calidad: Number(pesos.peso_calidad),
            peso_herramientas: Number(pesos.peso_herramientas),
          })
        }
        textoVacio={VACIO_VISTA_PREVIA_MERCHANDISER}
      />

      {soloLectura ? null : (
        <>
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
            ref={resultado}
            tabIndex={-1}
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
            {pendiente ? "Publicando…" : "Publicar versión"}
          </button>
        </>
      )}
    </form>
  );
}
