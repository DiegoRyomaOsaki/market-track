import { Pressable, StyleSheet, Text, View } from "react-native";

import { colores, espacio, radio } from "@/tema";

// Primitivos compartidos por los pasos del wizard de levantamiento (Antes/SOS,
// quiebres, precios, exhibiciones, Después): el stepper +/−, la tarjeta de
// sección, el enlace de contingencia y los estilos comunes. Una sola fuente de
// verdad para que los cinco pasos se vean iguales.

export function Stepper({
  valor,
  onCambio,
  etiqueta,
  min = 0,
}: {
  valor: number;
  onCambio: (n: number) => void;
  etiqueta: string;
  min?: number;
}) {
  return (
    <View style={s.stepper}>
      <Pressable
        onPress={() => onCambio(Math.max(min, valor - 1))}
        style={s.stepperBoton}
        accessibilityRole="button"
        accessibilityLabel={`Restar a ${etiqueta}`}
      >
        <Text style={s.stepperSigno}>−</Text>
      </Pressable>
      <Text style={s.stepperValor}>{valor}</Text>
      <Pressable
        onPress={() => onCambio(valor + 1)}
        style={s.stepperBoton}
        accessibilityRole="button"
        accessibilityLabel={`Sumar a ${etiqueta}`}
      >
        <Text style={s.stepperSigno}>+</Text>
      </Pressable>
    </View>
  );
}

export function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <View style={pasoEstilos.seccion}>
      <Text style={pasoEstilos.seccionTitulo}>{titulo}</Text>
      {children}
    </View>
  );
}

export function SiNo({
  valor,
  onCambio,
  etiqueta,
}: {
  valor: boolean;
  onCambio: (v: boolean) => void;
  etiqueta: string;
}) {
  return (
    <View style={s.siNo}>
      {[true, false].map((op) => (
        <Pressable
          key={String(op)}
          onPress={() => onCambio(op)}
          style={[s.opcion, valor === op && s.opcionActiva]}
          accessibilityRole="button"
          accessibilityState={{ selected: valor === op }}
          accessibilityLabel={`${op ? "Sí" : "No"} — ${etiqueta}`}
        >
          <Text style={[s.opcionTexto, valor === op && s.opcionTextoActivo]}>
            {op ? "Sí" : "No"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ContingenciaLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={pasoEstilos.contingencia}
      accessibilityRole="button"
    >
      <Text style={pasoEstilos.contingenciaTexto}>
        No puedo completar este paso
      </Text>
    </Pressable>
  );
}

export const pasoEstilos = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContenido: { paddingBottom: espacio.xl },
  seccion: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.m,
    marginTop: espacio.m,
    gap: espacio.s,
  },
  seccionTitulo: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  fila: { flexDirection: "row", alignItems: "center", gap: espacio.s },
  filaEntre: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: espacio.s,
  },
  filaTexto: { color: colores.texto, fontSize: 15, flex: 1 },
  nota: { color: colores.textoSuave, fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: colores.fondo,
    borderRadius: radio.s,
    borderWidth: 1,
    borderColor: colores.borde,
    color: colores.texto,
    fontSize: 15,
    paddingHorizontal: espacio.s,
    height: 44,
  },
  boton: {
    height: 52,
    borderRadius: radio.m,
    backgroundColor: colores.marca,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.l,
  },
  botonInactivo: { opacity: 0.4 },
  botonTexto: { color: colores.marcaTexto, fontSize: 16, fontWeight: "700" },
  botonSec: {
    height: 46,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.xs,
  },
  botonSecTexto: { color: colores.texto, fontSize: 15, fontWeight: "600" },
  contingencia: { alignItems: "center", paddingVertical: espacio.m },
  contingenciaTexto: {
    color: colores.textoSuave,
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});

const s = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "center", gap: espacio.s },
  stepperBoton: {
    width: 36,
    height: 36,
    borderRadius: radio.s,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.fondo,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperSigno: { color: colores.texto, fontSize: 20, fontWeight: "700" },
  stepperValor: {
    color: colores.texto,
    fontSize: 17,
    fontWeight: "700",
    minWidth: 28,
    textAlign: "center",
  },
  siNo: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.s,
    overflow: "hidden",
  },
  opcion: {
    // 44px de alto mínimo: se pulsa de pie, con una mano, en pasillo de tienda.
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.s,
    backgroundColor: colores.fondo,
  },
  opcionActiva: { backgroundColor: colores.marca },
  opcionTexto: { color: colores.textoSuave, fontSize: 14, fontWeight: "700" },
  opcionTextoActivo: { color: colores.marcaTexto },
});
