import { topeDeTexto, type CampoFormulario } from "@market-track/shared";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { pasoEstilos as p, SiNo } from "@/componentes/paso-comun";
import type { RespuestaCruda } from "@/lib/formulario";
import { colores, espacio, radio } from "@/tema";

// El control de UN campo del formulario configurable, por tipo. Lo comparten el
// paso configurable del wizard (MAR-80/90) y el checklist del check-in (MAR-98):
// dos pantallas, un solo dueño del render por tipo.

export function ControlCampo({
  campo,
  valor,
  onCambio,
  onAbrirCamara,
}: {
  campo: CampoFormulario;
  valor: RespuestaCruda;
  onCambio: (v: RespuestaCruda) => void;
  onAbrirCamara: () => void;
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
    const capturada = typeof valor === "string" && valor !== "";
    return (
      <View>
        <View style={p.fila}>
          <View
            style={[
              e.punto,
              {
                backgroundColor: capturada
                  ? colores.completado
                  : colores.textoSuave,
              },
            ]}
          />
          <Text style={p.filaTexto}>
            {capturada ? "Foto tomada" : "Toma la foto (solo cámara)"}
          </Text>
        </View>
        {/* El label contiene el texto visible (WCAG 2.5.3): quien dicta "Abrir
            cámara" por control de voz tiene que encontrar este botón. */}
        <Pressable
          onPress={onAbrirCamara}
          style={p.botonSec}
          accessibilityRole="button"
          accessibilityLabel={`${capturada ? "Repetir foto" : "Abrir cámara"} — ${campo.etiqueta}`}
        >
          <Text style={p.botonSecTexto}>
            {capturada ? "Repetir foto" : "Abrir cámara"}
          </Text>
        </Pressable>
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
      // El tope se aplica también al guardar (`coercionValorRespuesta`); aquí
      // impide que el mercaderista escriba de más y luego pierda lo tecleado sin
      // saber por qué. Los numéricos no llevan tope de longitud: los acota min/max.
      maxLength={numerico ? undefined : topeDeTexto(campo.tipo)}
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
  parrafo: { height: 96, paddingTop: espacio.s, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: espacio.s },
  chip: {
    minHeight: 44,
    justifyContent: "center",
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
  punto: { width: 10, height: 10, borderRadius: 5 },
});
