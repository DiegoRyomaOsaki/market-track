"use client";

import { useRef, useState, useTransition } from "react";

import {
  altaConfigPerfectStoreSchema,
  POLITICAS_POP,
  TIPOS_TIENDA,
  UNIDADES_SOS,
} from "@market-track/shared";

import { campo, Errores, etiqueta } from "@/components/panel/campos";
import { botonPrimario } from "@/components/panel/estilos";
import {
  previsualizarPerfectStore,
  publicarConfigPerfectStore,
} from "@/lib/metricas/acciones";
import {
  ETIQUETA_PERFECT_STORE,
  ETIQUETA_POLITICA_POP,
  ETIQUETA_TIPO_TIENDA,
  ETIQUETA_UNIDAD_SOS,
  EXPLICACION_PERFECT_STORE,
  NOTA_PUBLICAR,
  VACIO_VISTA_PREVIA_STORE,
  VARIABLES_PERFECT_STORE,
} from "@/lib/metricas/textos";

import { VistaPreviaPuntaje } from "./vista-previa-puntaje";

// Los pesos y objetivos de Perfect Store para una marca, con afinado opcional
// por categoría y tipo de tienda.
//
// Publicar SIEMPRE inserta una fila nueva: no se edita una configuración ya
// publicada porque los puntajes calculados con ella la referencian.

const CAMPOS_PESO = {
  distribucion: "peso_distribucion",
  visibilidad: "peso_visibilidad",
  precio: "peso_precio",
  pop: "peso_pop",
  orden: "peso_orden",
} as const;

const INICIAL: Record<string, string> = {
  peso_distribucion: "30",
  peso_visibilidad: "25",
  peso_precio: "25",
  peso_pop: "10",
  peso_orden: "10",
};

export function FormPerfectStore({
  tenantId,
  marcaId,
  categorias,
  soloLectura,
  hoy,
}: {
  tenantId: string;
  marcaId: string;
  categorias: { id: string; nombre: string }[];
  soloLectura: boolean;
  hoy: string;
}) {
  const [pesos, setPesos] = useState<Record<string, string>>(INICIAL);
  const [categoriaId, setCategoriaId] = useState("");
  const [tipoTienda, setTipoTienda] = useState("");
  const [sosObjetivo, setSosObjetivo] = useState("35");
  const [sosUnidad, setSosUnidad] = useState<string>("frentes");
  const [politicaPop, setPoliticaPop] = useState<string>("dentro_del_tope");
  const [ordenBien, setOrdenBien] = useState("100");
  const [ordenRegular, setOrdenRegular] = useState("50");
  const [ordenMal, setOrdenMal] = useState("0");
  const [vigenteDesde, setVigenteDesde] = useState(hoy);
  const [pendiente, arrancar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [publicado, setPublicado] = useState("");
  const primerPeso = useRef<HTMLInputElement>(null);
  const resultado = useRef<HTMLParagraphElement>(null);

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPublicado("");

    const parsed = altaConfigPerfectStoreSchema.safeParse({
      tenant_id: tenantId,
      marca_id: marcaId,
      // "" significa "aplica a todas": la columna es nullable y la resolución
      // trata el null como comodín.
      categoria_id: categoriaId === "" ? null : categoriaId,
      tipo_tienda: tipoTienda === "" ? null : tipoTienda,
      peso_distribucion: Number(pesos.peso_distribucion),
      peso_visibilidad: Number(pesos.peso_visibilidad),
      peso_precio: Number(pesos.peso_precio),
      peso_pop: Number(pesos.peso_pop),
      peso_orden: Number(pesos.peso_orden),
      sos_objetivo_pct: Number(sosObjetivo),
      sos_unidad: sosUnidad,
      politica_pop: politicaPop,
      orden_bien_pts: Number(ordenBien),
      orden_regular_pts: Number(ordenRegular),
      orden_mal_pts: Number(ordenMal),
      vigente_desde: vigenteDesde,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa los campos");
      // El foco va al campo que hay que corregir, no se queda en el botón: si
      // no, quien navega con teclado tiene que buscar a mano cuál era el
      // problema. Casi todos los errores de este formulario son de los pesos.
      primerPeso.current?.focus();
      return;
    }

    arrancar(async () => {
      const r = await publicarConfigPerfectStore(parsed.data);
      if (r.ok) {
        setPublicado("Configuración publicada");
        // Tras publicar, lo que importa es el resultado: se lleva el foco ahí
        // para que un lector de pantalla lo anuncie.
        resultado.current?.focus();
      } else {
        setError(r.error);
        primerPeso.current?.focus();
      }
    });
  }

  const suma = VARIABLES_PERFECT_STORE.reduce(
    (t, v) => t + Number(pesos[CAMPOS_PESO[v]] || 0),
    0,
  );

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <fieldset className="flex flex-wrap gap-3" disabled={soloLectura}>
        <legend className="text-[13px] font-bold">A qué aplica</legend>
        <label className="flex w-56 flex-col gap-1">
          <span className={etiqueta}>Categoría</span>
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className={campo}
          >
            <option value="">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-56 flex-col gap-1">
          <span className={etiqueta}>Tipo de tienda</span>
          <select
            value={tipoTienda}
            onChange={(e) => setTipoTienda(e.target.value)}
            className={campo}
          >
            <option value="">Todos los tipos</option>
            {TIPOS_TIENDA.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO_TIENDA[t]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3" disabled={soloLectura}>
        <legend className="text-[13px] font-bold">
          Pesos de las variables
        </legend>
        {VARIABLES_PERFECT_STORE.map((v) => {
          const nombreCampo = CAMPOS_PESO[v];
          return (
            <div key={v} className="flex flex-col gap-1">
              <label className="flex flex-col gap-1">
                <span className={etiqueta}>{ETIQUETA_PERFECT_STORE[v]}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  ref={v === "distribucion" ? primerPeso : undefined}
                  value={pesos[nombreCampo]}
                  onChange={(e) =>
                    setPesos((p) => ({ ...p, [nombreCampo]: e.target.value }))
                  }
                  aria-describedby={`ayuda-ps-${v}`}
                  className={`${campo} w-40`}
                />
              </label>
              {/* FUERA del `label`: dentro entraría en el nombre accesible del
                  campo y se leería dos veces (nombre + descripción). */}
              <span
                id={`ayuda-ps-${v}`}
                className="text-[11.5px] text-muted-foreground"
              >
                {EXPLICACION_PERFECT_STORE[v]}
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
        <legend className="text-[13px] font-bold">Share of Shelf y POP</legend>
        <label className="flex w-44 flex-col gap-1">
          <span className={etiqueta}>Objetivo (%)</span>
          <input
            type="number"
            min={0.01}
            max={100}
            step="0.01"
            value={sosObjetivo}
            onChange={(e) => setSosObjetivo(e.target.value)}
            className={campo}
          />
        </label>
        <label className="flex w-44 flex-col gap-1">
          <span className={etiqueta}>Se mide en</span>
          <select
            value={sosUnidad}
            onChange={(e) => setSosUnidad(e.target.value)}
            className={campo}
          >
            {UNIDADES_SOS.map((u) => (
              <option key={u} value={u}>
                {ETIQUETA_UNIDAD_SOS[u]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-64 flex-col gap-1">
          <span className={etiqueta}>Política de POP</span>
          <select
            value={politicaPop}
            onChange={(e) => setPoliticaPop(e.target.value)}
            className={campo}
          >
            {POLITICAS_POP.map((p) => (
              <option key={p} value={p}>
                {ETIQUETA_POLITICA_POP[p]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="flex flex-wrap gap-3" disabled={soloLectura}>
        <legend className="text-[13px] font-bold">
          Escala de orden y limpieza
        </legend>
        <label className="flex w-36 flex-col gap-1">
          <span className={etiqueta}>Bien</span>
          <input
            type="number"
            min={0}
            max={100}
            value={ordenBien}
            onChange={(e) => setOrdenBien(e.target.value)}
            className={campo}
          />
        </label>
        <label className="flex w-36 flex-col gap-1">
          <span className={etiqueta}>Regular</span>
          <input
            type="number"
            min={0}
            max={100}
            value={ordenRegular}
            onChange={(e) => setOrdenRegular(e.target.value)}
            className={campo}
          />
        </label>
        <label className="flex w-36 flex-col gap-1">
          <span className={etiqueta}>Mal</span>
          <input
            type="number"
            min={0}
            max={100}
            value={ordenMal}
            onChange={(e) => setOrdenMal(e.target.value)}
            className={campo}
          />
        </label>
      </fieldset>

      <VistaPreviaPuntaje
        onCalcular={() =>
          previsualizarPerfectStore(marcaId, {
            peso_distribucion: Number(pesos.peso_distribucion),
            peso_visibilidad: Number(pesos.peso_visibilidad),
            peso_precio: Number(pesos.peso_precio),
            peso_pop: Number(pesos.peso_pop),
            peso_orden: Number(pesos.peso_orden),
          })
        }
        textoVacio={VACIO_VISTA_PREVIA_STORE}
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
