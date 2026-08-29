"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  type TipoCampoFormulario,
  tipoCampoFormularioSchema,
} from "@market-track/shared";

import {
  guardarBorrador,
  publicarFormulario,
} from "@/lib/formularios/acciones";
import {
  type CampoEditable,
  type PasoEditable,
  construirDefinicion,
  definicionADraft,
  esNumero,
  esSeleccion,
  problemasDeDefinicion,
} from "@/lib/formularios/definicion";
import type { DefinicionBorrador } from "@/lib/formularios/schema";

import { campo, etiqueta } from "@/components/panel/campos";
import { botonPrimario, botonSecundario } from "@/components/panel/estilos";

import { VistaPrevia } from "./vista-previa";

const ETIQUETA_TIPO: Record<TipoCampoFormulario, string> = {
  texto: "Texto corto",
  parrafo: "Párrafo",
  entero: "Número entero",
  decimal: "Número decimal",
  booleano: "Sí / No",
  seleccion: "Selección (una opción)",
  seleccion_multiple: "Selección (varias)",
  foto: "Foto",
};

type Vista = "editor" | "previsualizacion";

type Props = {
  formularioId: string;
  nombreInicial: string;
  activoInicial: boolean;
  cliente: string;
  marca: string | null;
  ambito: "levantamiento" | "check_in";
  definicionInicial: DefinicionBorrador;
  versionPublicada: number | null;
  publicadaAt: string | null;
};

function nuevoId(): string {
  return crypto.randomUUID();
}

// Ids del DOM para devolver el foco tras agregar o eliminar. Se derivan del id
// del elemento, que es estable, en vez de pasar refs por las tres capas de
// componentes que hay hasta el input.
const idTituloPaso = (pasoId: string) => `paso-${pasoId}-titulo`;
const idEtiquetaCampo = (campoId: string) => `campo-${campoId}-etiqueta`;
const idAgregarCampo = (pasoId: string) => `paso-${pasoId}-agregar-campo`;
const ID_AGREGAR_PASO = "constructor-agregar-paso";

/**
 * "Quedan 3 campos." — el recuento va en el anuncio por dos motivos: le dice a
 * quien no ve la pantalla cuánto queda, y hace que dos borrados seguidos no
 * produzcan el MISMO texto. Una región viva cuyo texto no cambia no se vuelve a
 * anunciar, así que sin esto el segundo borrado sería mudo.
 */
function cuantosQuedan(n: number, singular: string, plural: string): string {
  if (n === 0) return `No queda ningún ${singular}.`;
  if (n === 1) return `Queda 1 ${singular}.`;
  return `Quedan ${n} ${plural}.`;
}

/** Intercambia dos elementos sin salirse del array (respeta noUncheckedIndexedAccess). */
function mover<T>(arr: readonly T[], idx: number, dir: -1 | 1): T[] {
  const copia = [...arr];
  const destino = idx + dir;
  if (destino < 0 || destino >= copia.length) return copia;
  const actual = copia[idx];
  const otro = copia[destino];
  if (actual === undefined || otro === undefined) return copia;
  copia[idx] = otro;
  copia[destino] = actual;
  return copia;
}

function campoNuevo(): CampoEditable {
  return {
    id: nuevoId(),
    tipo: "texto",
    etiqueta: "",
    obligatorio: false,
    ayuda: "",
    opcionesTexto: "",
    min: "",
    max: "",
  };
}

export function ConstructorFormulario({
  formularioId,
  nombreInicial,
  activoInicial,
  cliente,
  marca,
  ambito,
  definicionInicial,
  versionPublicada,
  publicadaAt,
}: Props) {
  const [nombre, setNombre] = useState(nombreInicial);
  const [activo, setActivo] = useState(activoInicial);
  const [pasos, setPasos] = useState<PasoEditable[]>(() =>
    definicionADraft(definicionInicial),
  );
  const [vista, setVista] = useState<Vista>("editor");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [sinGuardar, setSinGuardar] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  const [foco, setFoco] = useState<string | null>(null);

  const router = useRouter();

  // El foco se mueve DESPUÉS de que React pinte la lista nueva: dentro del
  // manejador el input recién agregado todavía no existe en el DOM.
  useEffect(() => {
    if (foco === null) return;
    document.getElementById(foco)?.focus();
    setFoco(null);
  }, [foco]);

  const problemas = useMemo(() => problemasDeDefinicion(pasos), [pasos]);
  const esValido = problemas.length === 0;

  // Ojo: NO toca `anuncio`. Todo borrado llama aquí al final, así que meter el
  // anuncio en `mensaje` lo pondría y lo borraría en la misma tanda — el lector
  // no llegaría a decir nada. Por eso son dos estados y no uno.
  function tocar() {
    setSinGuardar(true);
    setMensaje(null);
  }

  function editarPaso(idx: number, cambio: Partial<PasoEditable>) {
    setPasos((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...cambio } : p)),
    );
    tocar();
  }

  function editarCampo(
    pasoIdx: number,
    campoIdx: number,
    cambio: Partial<CampoEditable>,
  ) {
    setPasos((prev) =>
      prev.map((p, i) =>
        i === pasoIdx
          ? {
              ...p,
              campos: p.campos.map((c, j) =>
                j === campoIdx ? { ...c, ...cambio } : c,
              ),
            }
          : p,
      ),
    );
    tocar();
  }

  function agregarPaso() {
    const nuevo: PasoEditable = { id: nuevoId(), titulo: "", campos: [] };
    setPasos((prev) => [...prev, nuevo]);
    // Al input del paso nuevo: el lector lo anuncia al recibir el foco, así que
    // no hace falta además decir "paso agregado".
    setFoco(idTituloPaso(nuevo.id));
    tocar();
  }

  function eliminarPaso(idx: number) {
    const eliminado = pasos[idx];
    // Al que PASA A OCUPAR el sitio; si se borró el último, al de arriba. Salir
    // de la lista (al botón de agregar) solo cuando ya no queda ninguno: mandar
    // el foco ahí teniendo vecinos obliga a subir de nuevo por toda la lista.
    const vecino = pasos[idx + 1] ?? pasos[idx - 1];
    setPasos((prev) => prev.filter((_, i) => i !== idx));
    // El botón `✕` que tenía el foco se va con su fila. Sin esto el foco cae al
    // `<body>` y quien navega con teclado pierde su sitio en la lista.
    setFoco(vecino ? idTituloPaso(vecino.id) : ID_AGREGAR_PASO);
    setAnuncio(
      `Paso ${eliminado?.titulo.trim() || idx + 1} eliminado. ` +
        cuantosQuedan(pasos.length - 1, "paso", "pasos"),
    );
    tocar();
  }

  function moverPaso(idx: number, dir: -1 | 1) {
    setPasos((prev) => mover(prev, idx, dir));
    tocar();
  }

  function agregarCampo(pasoIdx: number) {
    const nuevo = campoNuevo();
    setPasos((prev) =>
      prev.map((p, i) =>
        i === pasoIdx ? { ...p, campos: [...p.campos, nuevo] } : p,
      ),
    );
    setFoco(idEtiquetaCampo(nuevo.id));
    tocar();
  }

  function eliminarCampo(pasoIdx: number, campoIdx: number) {
    const paso = pasos[pasoIdx];
    const eliminado = paso?.campos[campoIdx];
    // Mismo criterio que en los pasos: al que pasa a ocupar el sitio, si no al
    // de arriba, y solo al botón de agregar cuando el paso se queda sin campos.
    const vecino = paso?.campos[campoIdx + 1] ?? paso?.campos[campoIdx - 1];
    setPasos((prev) =>
      prev.map((p, i) =>
        i === pasoIdx
          ? { ...p, campos: p.campos.filter((_, j) => j !== campoIdx) }
          : p,
      ),
    );
    setFoco(
      vecino
        ? idEtiquetaCampo(vecino.id)
        : paso
          ? idAgregarCampo(paso.id)
          : null,
    );
    setAnuncio(
      `Campo ${eliminado?.etiqueta.trim() || campoIdx + 1} eliminado. ` +
        cuantosQuedan((paso?.campos.length ?? 1) - 1, "campo", "campos"),
    );
    tocar();
  }

  function moverCampo(pasoIdx: number, campoIdx: number, dir: -1 | 1) {
    setPasos((prev) =>
      prev.map((p, i) =>
        i === pasoIdx ? { ...p, campos: mover(p.campos, campoIdx, dir) } : p,
      ),
    );
    tocar();
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const r = await guardarBorrador(formularioId, {
      nombre,
      activo,
      definicion: construirDefinicion(pasos),
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSinGuardar(false);
    setMensaje("Borrador guardado.");
    router.refresh();
  }

  async function publicar() {
    if (!esValido) return;
    setGuardando(true);
    setError(null);
    const r = await publicarFormulario(formularioId, {
      nombre,
      activo,
      definicion: construirDefinicion(pasos),
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSinGuardar(false);
    setMensaje("Formulario publicado. El móvil recibirá esta versión.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <TarjetaCabecera
        cliente={cliente}
        marca={marca}
        ambito={ambito}
        versionPublicada={versionPublicada}
        publicadaAt={publicadaAt}
        nombre={nombre}
        activo={activo}
        onNombre={(v) => {
          setNombre(v);
          tocar();
        }}
        onActivo={(v) => {
          setActivo(v);
          tocar();
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-[9px] border border-border p-0.5"
          role="group"
          aria-label="Ver como"
        >
          <BotonVista
            activa={vista === "editor"}
            onClick={() => setVista("editor")}
          >
            Editor
          </BotonVista>
          <BotonVista
            activa={vista === "previsualizacion"}
            onClick={() => setVista("previsualizacion")}
          >
            Vista previa
          </BotonVista>
        </div>
        <div className="flex-1" />
        {sinGuardar && (
          <span className="text-[12.5px] font-semibold text-muted-foreground">
            Cambios sin guardar
          </span>
        )}
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando}
          className={`${botonSecundario} disabled:opacity-60`}
        >
          {guardando ? "Guardando…" : "Guardar borrador"}
        </button>
        <button
          type="button"
          onClick={() => void publicar()}
          disabled={guardando || !esValido}
          title={esValido ? undefined : "Corrige los avisos antes de publicar"}
          className={`${botonPrimario} disabled:opacity-60`}
        >
          Publicar
        </button>
      </div>

      {/* Las tres regiones se montan SIEMPRE y solo cambia su texto. Una que
          aparece al terminar la operación se anuncia en el mismo instante en
          que se inserta, y algunos lectores de pantalla se la pierden — justo
          en el primer intento, que es el que importa.

          `empty:hidden` es lo que evita que se vea la caja vacía: un hijo de
          cadena vacía no crea nodo de texto, así que `:empty` casa (Selectors
          nivel 4 excluye los nodos de texto de longitud cero). NO se cambia por
          `hidden={!mensaje}`: eso volvería a sacar el elemento del árbol y
          reintroduciría exactamente el fallo que este bloque arregla.

          Cada región lleva nombre porque hay dos `status` a la vez: con nombre
          se distinguen al navegar por regiones, y no hay que adivinar cuál sonó. */}
      <p
        role="alert"
        aria-label="Error de la operación"
        className="rounded-[9px] bg-alerta-suave px-3 py-2 text-[13px] font-semibold text-alerta-texto empty:hidden"
      >
        {error ?? ""}
      </p>
      <p
        role="status"
        aria-label="Resultado de la operación"
        className="rounded-[9px] bg-completado-suave px-3 py-2 text-[13px] font-semibold text-completado-texto empty:hidden"
      >
        {mensaje ?? ""}
      </p>
      {/* Lo que se elimina no deja rastro en pantalla, así que se dice aquí: el
          botón `✕` que tenía el foco desaparece con su fila, y sin esto el
          lector no anuncia nada de lo ocurrido. */}
      <p role="status" aria-label="Cambios en la lista" className="sr-only">
        {anuncio}
      </p>

      {vista === "previsualizacion" ? (
        <VistaPrevia pasos={pasos} />
      ) : (
        <Editor
          pasos={pasos}
          esCheckIn={ambito === "check_in"}
          problemas={problemas}
          onAgregarPaso={agregarPaso}
          onEditarPaso={editarPaso}
          onEliminarPaso={eliminarPaso}
          onMoverPaso={moverPaso}
          onAgregarCampo={agregarCampo}
          onEditarCampo={editarCampo}
          onEliminarCampo={eliminarCampo}
          onMoverCampo={moverCampo}
        />
      )}
    </div>
  );
}

function TarjetaCabecera({
  cliente,
  marca,
  ambito,
  versionPublicada,
  publicadaAt,
  nombre,
  activo,
  onNombre,
  onActivo,
}: {
  cliente: string;
  marca: string | null;
  ambito: "levantamiento" | "check_in";
  versionPublicada: number | null;
  publicadaAt: string | null;
  nombre: string;
  activo: boolean;
  onNombre: (v: string) => void;
  onActivo: (v: boolean) => void;
}) {
  const esCheckIn = ambito === "check_in";
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-6">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="rounded-full bg-accent px-2.5 py-0.5 font-semibold text-accent-foreground">
          {cliente}
        </span>
        <span className="rounded-full bg-accent px-2.5 py-0.5 font-semibold text-accent-foreground">
          {esCheckIn ? "Check-in" : "Levantamiento"}
        </span>
        <span className="rounded-full bg-accent px-2.5 py-0.5 font-semibold text-accent-foreground">
          {marca ?? (esCheckIn ? "De la visita" : "Todas las marcas")}
        </span>
        {versionPublicada != null ? (
          <span>
            Publicado: v{versionPublicada}
            {publicadaAt &&
              ` · ${new Date(publicadaAt).toLocaleDateString("es-PE")}`}
          </span>
        ) : (
          <span>Sin publicar todavía</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Nombre del formulario</span>
          <input
            value={nombre}
            onChange={(e) => onNombre(e.target.value)}
            className={campo}
          />
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => onActivo(e.target.checked)}
            className="size-4"
          />
          <span className={etiqueta}>Activo</span>
        </label>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Aquí configuras la presentación y los campos libres. Los pasos con
        lógica del negocio —quiebres, precios y Share of Shelf— los calcula el
        sistema y no se editan desde aquí. Publicar congela una versión
        inmutable y la envía al teléfono; los borradores no salen del panel.
      </p>
    </div>
  );
}

function BotonVista({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`h-[32px] rounded-[7px] px-3 text-[13px] font-semibold ${
        activa
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Editor({
  pasos,
  esCheckIn,
  problemas,
  onAgregarPaso,
  onEditarPaso,
  onEliminarPaso,
  onMoverPaso,
  onAgregarCampo,
  onEditarCampo,
  onEliminarCampo,
  onMoverCampo,
}: {
  pasos: PasoEditable[];
  esCheckIn: boolean;
  problemas: string[];
  onAgregarPaso: () => void;
  onEditarPaso: (idx: number, cambio: Partial<PasoEditable>) => void;
  onEliminarPaso: (idx: number) => void;
  onMoverPaso: (idx: number, dir: -1 | 1) => void;
  onAgregarCampo: (pasoIdx: number) => void;
  onEditarCampo: (
    pasoIdx: number,
    campoIdx: number,
    cambio: Partial<CampoEditable>,
  ) => void;
  onEliminarCampo: (pasoIdx: number, campoIdx: number) => void;
  onMoverCampo: (pasoIdx: number, campoIdx: number, dir: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {problemas.length > 0 && (
        <div
          role="status"
          className="rounded-xl border border-border bg-alerta-suave/50 p-4 text-[13px] text-alerta-texto"
        >
          <p className="font-semibold">Falta esto para poder publicar:</p>
          <ul className="mt-1.5 list-disc pl-5">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {pasos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
          El formulario no tiene pasos. Agrega el primero para empezar.
        </p>
      ) : (
        pasos.map((paso, i) => (
          <PasoTarjeta
            key={paso.id}
            paso={paso}
            esCheckIn={esCheckIn}
            indice={i}
            total={pasos.length}
            onEditar={(cambio) => onEditarPaso(i, cambio)}
            onEliminar={() => onEliminarPaso(i)}
            onMover={(dir) => onMoverPaso(i, dir)}
            onAgregarCampo={() => onAgregarCampo(i)}
            onEditarCampo={(campoIdx, cambio) =>
              onEditarCampo(i, campoIdx, cambio)
            }
            onEliminarCampo={(campoIdx) => onEliminarCampo(i, campoIdx)}
            onMoverCampo={(campoIdx, dir) => onMoverCampo(i, campoIdx, dir)}
          />
        ))
      )}

      <button
        type="button"
        id={ID_AGREGAR_PASO}
        onClick={onAgregarPaso}
        className={`${botonSecundario} self-start`}
      >
        + Agregar paso
      </button>
    </div>
  );
}

function PasoTarjeta({
  paso,
  esCheckIn,
  indice,
  total,
  onEditar,
  onEliminar,
  onMover,
  onAgregarCampo,
  onEditarCampo,
  onEliminarCampo,
  onMoverCampo,
}: {
  paso: PasoEditable;
  esCheckIn: boolean;
  indice: number;
  total: number;
  onEditar: (cambio: Partial<PasoEditable>) => void;
  onEliminar: () => void;
  onMover: (dir: -1 | 1) => void;
  onAgregarCampo: () => void;
  onEditarCampo: (campoIdx: number, cambio: Partial<CampoEditable>) => void;
  onEliminarCampo: (campoIdx: number) => void;
  onMoverCampo: (campoIdx: number, dir: -1 | 1) => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-background p-6">
      <div className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className={etiqueta}>Título del paso {indice + 1}</span>
          <input
            id={idTituloPaso(paso.id)}
            value={paso.titulo}
            onChange={(e) => onEditar({ titulo: e.target.value })}
            placeholder="p. ej. Datos adicionales"
            className={campo}
          />
        </label>
        <BotonesOrden
          indice={indice}
          total={total}
          onMover={onMover}
          onEliminar={onEliminar}
          etiquetaEntidad={`el paso ${indice + 1}`}
        />
      </div>

      {paso.campos.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Este paso no tiene campos.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {paso.campos.map((campoItem, j) => (
            <CampoTarjeta
              key={campoItem.id}
              campo={campoItem}
              esCheckIn={esCheckIn}
              indice={j}
              total={paso.campos.length}
              onEditar={(cambio) => onEditarCampo(j, cambio)}
              onEliminar={() => onEliminarCampo(j)}
              onMover={(dir) => onMoverCampo(j, dir)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        id={idAgregarCampo(paso.id)}
        onClick={onAgregarCampo}
        className={`${botonSecundario} self-start`}
      >
        + Agregar campo
      </button>
    </section>
  );
}

function CampoTarjeta({
  campo: c,
  esCheckIn,
  indice,
  total,
  onEditar,
  onEliminar,
  onMover,
}: {
  campo: CampoEditable;
  esCheckIn: boolean;
  indice: number;
  total: number;
  onEditar: (cambio: Partial<CampoEditable>) => void;
  onEliminar: () => void;
  onMover: (dir: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[9px] border border-border bg-muted/20 p-4">
      <div className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className={etiqueta}>Etiqueta</span>
          <input
            id={idEtiquetaCampo(c.id)}
            value={c.etiqueta}
            onChange={(e) => onEditar({ etiqueta: e.target.value })}
            placeholder="Lo que lee el mercaderista"
            className={campo}
          />
        </label>
        <label className="flex w-44 flex-col gap-1.5">
          <span className={etiqueta}>Tipo</span>
          <select
            value={c.tipo}
            onChange={(e) =>
              onEditar({ tipo: e.target.value as TipoCampoFormulario })
            }
            className={campo}
          >
            {tipoCampoFormularioSchema.options.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
        <BotonesOrden
          indice={indice}
          total={total}
          onMover={onMover}
          onEliminar={onEliminar}
          etiquetaEntidad={`el campo ${c.etiqueta.trim() || indice + 1}`}
        />
      </div>

      {esSeleccion(c.tipo) && (
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Opciones (una por línea)</span>
          <textarea
            value={c.opcionesTexto}
            onChange={(e) => onEditar({ opcionesTexto: e.target.value })}
            rows={3}
            placeholder={"Buena\nRegular\nMala"}
            className={`${campo} h-auto py-2`}
          />
        </label>
      )}

      {esNumero(c.tipo) && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Mínimo (opcional)</span>
            <input
              type="number"
              value={c.min}
              onChange={(e) => onEditar({ min: e.target.value })}
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Máximo (opcional)</span>
            <input
              type="number"
              value={c.max}
              onChange={(e) => onEditar({ max: e.target.value })}
              className={campo}
            />
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className={etiqueta}>Ayuda (opcional)</span>
        <input
          value={c.ayuda}
          onChange={(e) => onEditar({ ayuda: e.target.value })}
          placeholder="Un texto de apoyo bajo el campo"
          className={campo}
        />
      </label>

      {esCheckIn ? (
        <p className="text-[12px] text-muted-foreground">
          El checklist nunca bloquea el check-in: no hay campos obligatorios.
        </p>
      ) : (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={c.obligatorio}
            onChange={(e) => onEditar({ obligatorio: e.target.checked })}
            className="size-4"
          />
          <span className={etiqueta}>Obligatorio</span>
        </label>
      )}
    </div>
  );
}

function BotonesOrden({
  indice,
  total,
  onMover,
  onEliminar,
  etiquetaEntidad,
}: {
  indice: number;
  total: number;
  onMover: (dir: -1 | 1) => void;
  onEliminar: () => void;
  etiquetaEntidad: string;
}) {
  const boton =
    "flex size-[38px] items-center justify-center rounded-[9px] border border-border bg-background text-[15px] hover:bg-muted disabled:opacity-40";
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => onMover(-1)}
        disabled={indice === 0}
        aria-label={`Subir ${etiquetaEntidad}`}
        className={boton}
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onMover(1)}
        disabled={indice === total - 1}
        aria-label={`Bajar ${etiquetaEntidad}`}
        className={boton}
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onEliminar}
        aria-label={`Eliminar ${etiquetaEntidad}`}
        className={`${boton} text-alerta-texto`}
      >
        ✕
      </button>
    </div>
  );
}
