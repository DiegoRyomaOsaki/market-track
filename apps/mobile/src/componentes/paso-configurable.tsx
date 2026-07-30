import type { CampoFormulario } from "@market-track/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  ContingenciaLink,
  pasoEstilos as p,
  Seccion,
  SiNo,
} from "@/componentes/paso-comun";
import {
  coercionValorRespuesta,
  estaContestado,
  faltanObligatorios,
  type RespuestaCruda,
} from "@/lib/formulario";
import { guardarRespuestas, useRespuestas } from "@/lib/levantamiento";
import type { PasoWizardConfigurable } from "@/lib/pasos-levantamiento";
import { colores, espacio, radio } from "@/tema";

// Un paso CONFIGURABLE del wizard (MAR-80): renderiza los campos libres de la
// definición por tipo, reusando los primitivos de paso-comun. Guarda las
// respuestas en `levantamiento_respuesta` al continuar. Los campos `foto` quedan
// aplazados (no hay enlace a la cola de fotos aún): se muestran deshabilitados y,
// si son obligatorios, obligan a pasar el paso por contingencia.

type Props = {
  paso: PasoWizardConfigurable;
  levantamientoId: string;
  tenantId: string;
  onCompletar: () => void;
  onContingencia: () => void;
};

/** El valor guardado (JSON) de vuelta a su forma cruda para editar. */
function crudoDesdeValor(json: string): RespuestaCruda {
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") return v;
    return undefined;
  } catch {
    return undefined;
  }
}

export function PasoConfigurable({
  paso,
  levantamientoId,
  tenantId,
  onCompletar,
  onContingencia,
}: Props) {
  const { respuestas: filas, cargando } = useRespuestas(levantamientoId);
  const [valores, setValores] = useState<Record<string, RespuestaCruda>>({});
  const [guardando, setGuardando] = useState(false);
  const sembrado = useRef(false);

  const rowIds = useMemo(
    () => Object.fromEntries(filas.map((f) => [f.campo_id, f.id])),
    [filas],
  );

  useEffect(() => {
    if (sembrado.current || cargando) return;
    sembrado.current = true;
    const inicial: Record<string, RespuestaCruda> = {};
    // Los sí/no arrancan en "No" (siempre contestados); las listas, vacías.
    for (const c of paso.campos) {
      if (c.tipo === "booleano") inicial[c.id] = false;
      if (c.tipo === "seleccion_multiple") inicial[c.id] = [];
    }
    for (const f of filas) inicial[f.campo_id] = crudoDesdeValor(f.valor);
    setValores(inicial);
  }, [cargando, filas, paso.campos]);

  function set(id: string, v: RespuestaCruda) {
    setValores((prev) => ({ ...prev, [id]: v }));
  }

  const faltan = faltanObligatorios(paso.campos, valores);

  async function continuar() {
    if (guardando || faltan) return;
    setGuardando(true);
    try {
      const respuestas = paso.campos
        .filter((c) => c.tipo !== "foto" && estaContestado(valores[c.id]))
        .map((c) => ({
          id: rowIds[c.id] ?? null,
          campo_id: c.id,
          valor: coercionValorRespuesta(c, valores[c.id]),
        }));
      await guardarRespuestas({
        levantamiento_id: levantamientoId,
        tenant_id: tenantId,
        respuestas,
      });
      onCompletar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ScrollView
      style={p.scroll}
      contentContainerStyle={p.scrollContenido}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={e.titulo}>{paso.titulo || "Datos adicionales"}</Text>

      {paso.campos.length === 0 ? (
        <Text style={[p.nota, { marginTop: espacio.l }]}>
          Este paso no tiene campos.
        </Text>
      ) : (
        paso.campos.map((campo) => (
          <Seccion key={campo.id} titulo={etiquetaCampo(campo)}>
            <Control
              campo={campo}
              valor={valores[campo.id]}
              onCambio={(v) => set(campo.id, v)}
            />
            {campo.ayuda ? <Text style={p.nota}>{campo.ayuda}</Text> : null}
          </Seccion>
        ))
      )}

      <Pressable
        onPress={() => void continuar()}
        disabled={guardando || faltan}
        style={[p.boton, (guardando || faltan) && p.botonInactivo]}
        accessibilityRole="button"
      >
        {guardando ? (
          <ActivityIndicator color={colores.marcaTexto} />
        ) : (
          <Text style={p.botonTexto}>Continuar</Text>
        )}
      </Pressable>
      {faltan ? (
        <Text style={[p.nota, e.aviso]}>
          Completa los campos obligatorios (*) para continuar, o registra una
          contingencia.
        </Text>
      ) : null}

      <ContingenciaLink onPress={onContingencia} />
    </ScrollView>
  );
}

function etiquetaCampo(campo: CampoFormulario): string {
  const base = campo.etiqueta || "Campo";
  return campo.obligatorio ? `${base} *` : base;
}

function Control({
  campo,
  valor,
  onCambio,
}: {
  campo: CampoFormulario;
  valor: RespuestaCruda;
  onCambio: (v: RespuestaCruda) => void;
}) {
  if (campo.tipo === "booleano") {
    return (
      <SiNo
        valor={valor === true}
        onCambio={onCambio}
        etiqueta={campo.etiqueta}
      />
    );
  }

  if (campo.tipo === "seleccion" || campo.tipo === "seleccion_multiple") {
    return <Opciones campo={campo} valor={valor} onCambio={onCambio} />;
  }

  if (campo.tipo === "foto") {
    return (
      <View style={e.fotoAplazada}>
        <Text style={e.fotoTexto}>📷 Foto — disponible próximamente</Text>
      </View>
    );
  }

  const numerico = campo.tipo === "entero" || campo.tipo === "decimal";
  return (
    <TextInput
      value={typeof valor === "string" ? valor : ""}
      onChangeText={onCambio}
      style={[p.input, campo.tipo === "parrafo" && e.parrafo]}
      multiline={campo.tipo === "parrafo"}
      keyboardType={
        campo.tipo === "entero"
          ? "number-pad"
          : campo.tipo === "decimal"
            ? "decimal-pad"
            : "default"
      }
      placeholder={numerico ? "0" : "Escribe aquí…"}
      placeholderTextColor={colores.textoSuave}
      accessibilityLabel={campo.etiqueta}
    />
  );
}

function Opciones({
  campo,
  valor,
  onCambio,
}: {
  campo: CampoFormulario;
  valor: RespuestaCruda;
  onCambio: (v: RespuestaCruda) => void;
}) {
  const multiple = campo.tipo === "seleccion_multiple";
  const seleccionadas = new Set(
    multiple
      ? Array.isArray(valor)
        ? valor
        : []
      : valor
        ? [String(valor)]
        : [],
  );

  function alternar(opcion: string) {
    if (!multiple) {
      onCambio(opcion);
      return;
    }
    const siguiente = new Set(seleccionadas);
    if (siguiente.has(opcion)) siguiente.delete(opcion);
    else siguiente.add(opcion);
    onCambio([...siguiente]);
  }

  return (
    <View style={e.chips}>
      {(campo.opciones ?? []).map((opcion) => {
        const activa = seleccionadas.has(opcion);
        return (
          <Pressable
            key={opcion}
            onPress={() => alternar(opcion)}
            style={[e.chip, activa && e.chipActivo]}
            accessibilityRole="button"
            accessibilityState={{ selected: activa }}
            accessibilityLabel={`${opcion} — ${campo.etiqueta}`}
          >
            <Text style={[e.chipTexto, activa && e.chipTextoActivo]}>
              {opcion}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const e = StyleSheet.create({
  titulo: {
    color: colores.texto,
    fontSize: 17,
    fontWeight: "700",
    marginTop: espacio.s,
  },
  parrafo: { height: 96, paddingTop: espacio.s, textAlignVertical: "top" },
  aviso: { marginTop: espacio.s, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: espacio.s },
  chip: {
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.s,
    borderRadius: radio.s,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.fondo,
  },
  chipActivo: { backgroundColor: colores.marca, borderColor: colores.marca },
  chipTexto: { color: colores.texto, fontSize: 14, fontWeight: "600" },
  chipTextoActivo: { color: colores.marcaTexto },
  fotoAplazada: {
    height: 72,
    borderRadius: radio.s,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
  },
  fotoTexto: { color: colores.textoSuave, fontSize: 14, fontWeight: "600" },
});
