import type { TipoCampoFormulario } from "@market-track/shared";

import {
  type CampoEditable,
  type PasoEditable,
  esNumero,
  esSeleccion,
  opcionesDeTexto,
} from "@/lib/formularios/definicion";

// La vista previa: el formulario tal como lo verá el mercaderista. Todos los
// controles van deshabilitados —es una maqueta, no se rellena aquí—. Lee el
// mismo estado editable que el constructor, así refleja los cambios al vuelo.

const control =
  "h-[38px] w-full rounded-[9px] border border-border bg-muted/40 px-3 text-[13px]";

export function VistaPrevia({ pasos }: { pasos: PasoEditable[] }) {
  if (pasos.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
        Aún no hay pasos que previsualizar. Agrega un paso en el editor.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {pasos.map((paso, i) => (
        <section
          key={paso.id}
          className="flex flex-col gap-4 rounded-xl border border-border bg-background p-6"
        >
          <h3 className="text-[15px] font-semibold">
            {paso.titulo.trim() || `Paso ${i + 1}`}
          </h3>
          {paso.campos.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              (Sin campos en este paso)
            </p>
          ) : (
            paso.campos.map((campo) => (
              <CampoPrevia key={campo.id} campo={campo} />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function CampoPrevia({ campo }: { campo: CampoEditable }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold">
        {campo.etiqueta.trim() || "(campo sin etiqueta)"}
        {campo.obligatorio && (
          <span className="text-alerta-texto" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </span>
      <ControlPrevia campo={campo} />
      {campo.ayuda.trim() && (
        <span className="text-[12px] text-muted-foreground">
          {campo.ayuda.trim()}
        </span>
      )}
    </label>
  );
}

function ControlPrevia({ campo }: { campo: CampoEditable }) {
  const tipo: TipoCampoFormulario = campo.tipo;

  if (tipo === "parrafo") {
    return <textarea disabled rows={3} className={`${control} h-auto py-2`} />;
  }
  if (tipo === "booleano") {
    return (
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <input type="checkbox" disabled className="size-4" />
        Sí
      </span>
    );
  }
  if (tipo === "foto") {
    return (
      <span className="flex h-24 items-center justify-center rounded-[9px] border border-dashed border-border bg-muted/40 text-[13px] text-muted-foreground">
        📷 Foto — solo cámara, nunca galería
      </span>
    );
  }
  if (esNumero(tipo)) {
    return <input type="number" disabled className={control} />;
  }
  if (esSeleccion(tipo)) {
    const opciones = opcionesDeTexto(campo.opcionesTexto);
    if (tipo === "seleccion_multiple") {
      return (
        <span className="flex flex-col gap-1.5">
          {opciones.length === 0 ? (
            <span className="text-[13px] text-muted-foreground">
              (sin opciones)
            </span>
          ) : (
            opciones.map((o) => (
              <span
                key={o}
                className="flex items-center gap-2 text-[13px] text-muted-foreground"
              >
                <input type="checkbox" disabled className="size-4" />
                {o}
              </span>
            ))
          )}
        </span>
      );
    }
    return (
      <select disabled className={control}>
        {opciones.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }
  return <input disabled className={control} />;
}
