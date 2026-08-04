import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AyudaBoton } from "@/componentes/ayuda-boton";
import { visitaListaParaCheckOut } from "@/lib/check-out";
import {
  useContingenciasDeVisita,
  useMarcasDeVisita,
  useVisita,
} from "@/lib/levantamiento";
import { PASOS } from "@/lib/pasos-levantamiento";
import { iniciarTransito } from "@/lib/transito";
import { type ResultadoUbicacion, ubicacionActual } from "@/lib/ubicacion";
import { cerrarVisitaCheckOut } from "@/lib/visita";
import { colores, espacio, radio } from "@/tema";

// Check-out: resumen de la visita, bloqueo si falta auditar una marca (con salto
// al paso faltante), bitácora opcional y salida con GPS. NO espera a que suban
// las fotos — la cola a R2 sigue su curso. Al cerrar, arranca el cronómetro de
// tránsito hacia la siguiente tienda.

const PASO_LABEL: Record<string, string> = {
  ...Object.fromEntries(PASOS.map((p) => [p.paso, p.titulo])),
  checkin: "Check-in",
  checkout: "Check-out",
};

export default function CheckOut() {
  const router = useRouter();
  const { visitaId } = useLocalSearchParams<{ visitaId: string }>();
  const { visita, cargando } = useVisita(visitaId);
  const { marcas } = useMarcasDeVisita(visitaId);
  const contingencias = useContingenciasDeVisita(visitaId);

  const [bitacora, setBitacora] = useState("");
  const [ubic, setUbic] = useState<ResultadoUbicacion | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void ubicacionActual().then(setUbic);
  }, []);

  const nombrePorLevantamiento = useMemo(() => {
    const m = new Map<string, string>();
    for (const marca of marcas) {
      if (marca.levantamiento_id) m.set(marca.levantamiento_id, marca.nombre);
    }
    return m;
  }, [marcas]);

  const lista = visitaListaParaCheckOut(
    marcas.map((m) => m.levantamiento_estado),
  );
  const yaCerrada = visita?.estado === "completada";

  async function confirmar() {
    if (!visita || !ubic?.ok || !lista || guardando) return;
    setGuardando(true);
    try {
      const ahora = new Date().toISOString();
      await cerrarVisitaCheckOut({
        visita_id: visitaId,
        punto: ubic.punto,
        capturado_at: ahora,
        bitacora: bitacora.trim() || null,
      });
      // Arranca el cronómetro de traslado hacia la siguiente tienda.
      await iniciarTransito(ahora);
      router.replace("/");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return (
      <View style={e.centro}>
        <ActivityIndicator color={colores.marca} />
      </View>
    );
  }

  return (
    <ScrollView
      style={e.pantalla}
      contentContainerStyle={{ padding: espacio.m, paddingBottom: espacio.xl }}
    >
      <Pressable
        onPress={() => router.replace(`/levantamiento/${visitaId}`)}
        hitSlop={8}
        style={e.volver}
      >
        <Text style={e.volverTexto}>‹ Marcas</Text>
      </Pressable>
      <View style={e.tituloFila}>
        <Text style={e.titulo}>Check-out</Text>
        <AyudaBoton clave="check_out" />
      </View>
      {visita ? <Text style={e.tienda}>{visita.tienda_nombre}</Text> : null}

      {yaCerrada ? (
        <View style={e.tarjeta}>
          <Text style={[e.estado, { color: colores.completado }]}>
            ✓ Visita cerrada
          </Text>
          <Pressable
            onPress={() => router.replace("/")}
            style={e.boton}
            accessibilityRole="button"
          >
            <Text style={e.botonTexto}>Volver a Mi día</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Seccion titulo="Marcas auditadas">
            {marcas.map((m) => {
              const est = estadoMarca(m.levantamiento_estado);
              return (
                <Pressable
                  key={m.id}
                  disabled={est !== "pendiente" && est !== "en_curso"}
                  onPress={() =>
                    router.push(`/levantamiento/${visitaId}/${m.id}`)
                  }
                  style={e.fila}
                >
                  <Text style={e.filaTexto} numberOfLines={1}>
                    {m.nombre}
                  </Text>
                  <Text style={[e.chip, { color: COLOR[est] }]}>
                    {ETIQUETA[est]}
                  </Text>
                </Pressable>
              );
            })}
            {!lista ? (
              <Text style={e.avisoAlerta}>
                Faltan marcas por auditar. Toca una para completarla; también
                puedes omitir un paso con motivo (contingencia).
              </Text>
            ) : null}
          </Seccion>

          {contingencias.length > 0 ? (
            <Seccion titulo="Pasos omitidos (contingencia)">
              {contingencias.map((c, i) => (
                <View key={i} style={e.contingencia}>
                  <Text style={e.contPaso}>
                    {c.levantamiento_id
                      ? `${nombrePorLevantamiento.get(c.levantamiento_id) ?? "Marca"} · `
                      : ""}
                    {PASO_LABEL[c.paso] ?? c.paso}
                  </Text>
                  <Text style={e.contMotivo}>{c.motivo}</Text>
                </View>
              ))}
            </Seccion>
          ) : null}

          <Seccion titulo="Bitácora (opcional)">
            <TextInput
              value={bitacora}
              onChangeText={setBitacora}
              placeholder="Comentarios de la visita…"
              placeholderTextColor={colores.textoSuave}
              style={e.input}
              multiline
              accessibilityLabel="Bitácora de la visita"
            />
          </Seccion>

          <Seccion titulo="Salida">
            <View style={e.fila}>
              <View
                style={[
                  e.punto,
                  {
                    backgroundColor: ubic?.ok
                      ? colores.completado
                      : colores.alerta,
                  },
                ]}
              />
              <Text style={e.filaTexto}>
                {ubic == null
                  ? "Ubicándote…"
                  : ubic.ok
                    ? "Ubicación lista"
                    : "No se pudo obtener la ubicación"}
              </Text>
            </View>
          </Seccion>

          <Pressable
            onPress={() => void confirmar()}
            disabled={!lista || !ubic?.ok || guardando}
            style={[
              e.boton,
              (!lista || !ubic?.ok || guardando) && e.botonInactivo,
            ]}
            accessibilityRole="button"
          >
            {guardando ? (
              <ActivityIndicator color={colores.marcaTexto} />
            ) : (
              <Text style={e.botonTexto}>Confirmar check-out</Text>
            )}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

type EstadoMarca = "pendiente" | "en_curso" | "completado" | "omitido";

function estadoMarca(estado: string | null): EstadoMarca {
  if (estado === "completado") return "completado";
  if (estado === "omitido") return "omitido";
  if (estado === "en_curso") return "en_curso";
  return "pendiente";
}

const ETIQUETA: Record<EstadoMarca, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  completado: "Completado",
  omitido: "Omitido",
};

const COLOR: Record<EstadoMarca, string> = {
  pendiente: colores.textoSuave,
  en_curso: colores.marca,
  completado: colores.completado,
  omitido: colores.ambar,
};

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <View style={e.seccion}>
      <Text style={e.seccionTitulo}>{titulo}</Text>
      {children}
    </View>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  centro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colores.fondo,
  },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  tituloFila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: espacio.s,
  },
  titulo: {
    color: colores.texto,
    fontSize: 24,
    fontWeight: "800",
  },
  tienda: { color: colores.textoSuave, fontSize: 14, marginTop: 2 },
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
  fila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: espacio.s,
  },
  filaTexto: { color: colores.texto, fontSize: 15, flex: 1 },
  chip: { fontSize: 12, fontWeight: "700" },
  punto: { width: 10, height: 10, borderRadius: 5 },
  avisoAlerta: {
    color: colores.textoSuave,
    fontSize: 13,
    lineHeight: 18,
    marginTop: espacio.xs,
  },
  contingencia: {
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    paddingTop: espacio.s,
  },
  contPaso: { color: colores.texto, fontSize: 14, fontWeight: "600" },
  contMotivo: { color: colores.textoSuave, fontSize: 13, marginTop: 2 },
  input: {
    backgroundColor: colores.fondo,
    borderRadius: radio.s,
    borderWidth: 1,
    borderColor: colores.borde,
    color: colores.texto,
    fontSize: 15,
    padding: espacio.s,
    minHeight: 72,
    textAlignVertical: "top",
  },
  tarjeta: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.l,
    marginTop: espacio.l,
    gap: espacio.m,
  },
  estado: { fontSize: 18, fontWeight: "700" },
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
});
