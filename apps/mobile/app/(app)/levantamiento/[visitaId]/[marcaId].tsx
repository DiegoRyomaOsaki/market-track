import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ContingenciaModal } from "@/componentes/contingencia-modal";
import {
  completarLevantamiento,
  crearLevantamiento,
  useContingencias,
  useMarcasDeVisita,
  useVisita,
} from "@/lib/levantamiento";
import { levantamientoCompleto, PASOS } from "@/lib/pasos-levantamiento";
import { useSesion } from "@/sesion";
import { colores, espacio, radio } from "@/tema";

// El SHELL del wizard de levantamiento de una marca (MAR-36): navegación
// secuencial de los 5 pasos, barra de progreso y contingencia (bypass) en cada
// paso. El CONTENIDO de cada paso lo implementan MAR-37 (Antes + Share of Shelf)
// y MAR-38 (quiebres, precios, exhibiciones, Después): aquí cada paso es un
// marcador provisional con el botón "Completar" que esas tickets reemplazan por
// la captura real. Los pasos omitidos por contingencia SÍ se persisten (tabla
// `contingencia`); los "hechos" son de sesión hasta que MAR-37/38 den datos que
// derivar.

export default function WizardLevantamiento() {
  const router = useRouter();
  const sesion = useSesion();
  const { visitaId, marcaId } = useLocalSearchParams<{
    visitaId: string;
    marcaId: string;
  }>();

  const { visita } = useVisita(visitaId);
  const { marcas } = useMarcasDeVisita(visitaId);
  const marca = marcas.find((m) => m.id === marcaId) ?? null;
  const levantamientoId = marca?.levantamiento_id ?? null;
  const contingencias = useContingencias(levantamientoId);

  const [hechos, setHechos] = useState<ReadonlySet<string>>(new Set());
  const [mostrarContingencia, setMostrarContingencia] = useState(false);
  const creando = useRef(false);
  const completando = useRef(false);

  // Crea el levantamiento de la marca la primera vez que se entra (idempotente:
  // solo si aún no existe). `tenant_id` sale de la visita local.
  useEffect(() => {
    if (creando.current || !visita || !marca || levantamientoId) return;
    creando.current = true;
    void crearLevantamiento({
      tenant_id: visita.tenant_id,
      visita_id: visitaId,
      marca_id: marcaId,
    });
  }, [visita, marca, levantamientoId, visitaId, marcaId]);

  const omitidos = useMemo(() => {
    const pasosOmitidos = new Set(contingencias.map((c) => c.paso));
    return new Set(PASOS.filter((p) => pasosOmitidos.has(p.paso)).map((p) => p.id));
  }, [contingencias]);

  const completo = levantamientoCompleto(hechos, omitidos);
  const yaCompletado =
    marca?.levantamiento_estado === "completado" ||
    marca?.levantamiento_estado === "omitido";

  // Cuando todos los pasos están hechos u omitidos, se cierra el levantamiento y
  // se vuelve al selector (que mostrará la marca "Completado").
  useEffect(() => {
    if (!completo || !levantamientoId || completando.current || yaCompletado) {
      return;
    }
    completando.current = true;
    void completarLevantamiento(levantamientoId).then(() => {
      router.replace(`/levantamiento/${visitaId}`);
    });
  }, [completo, levantamientoId, yaCompletado, router, visitaId]);

  const activo = PASOS.find((p) => !hechos.has(p.id) && !omitidos.has(p.id)) ?? null;
  const hechosCount = PASOS.filter(
    (p) => hechos.has(p.id) || omitidos.has(p.id),
  ).length;

  if (!marca || !levantamientoId || !visita) {
    return (
      <View style={e.centro}>
        <ActivityIndicator color={colores.marca} />
      </View>
    );
  }

  if (yaCompletado) {
    return (
      <View style={e.pantalla}>
        <Encabezado nombre={marca.nombre} onVolver={() => router.back()} />
        <View style={e.tarjeta}>
          <Text style={[e.estado, { color: colores.completado }]}>
            ✓ Marca completada
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={e.pantalla}>
      <Encabezado
        nombre={marca.nombre}
        onVolver={() => router.replace(`/levantamiento/${visitaId}`)}
      />

      <View style={e.barra}>
        {PASOS.map((p) => {
          const hecho = hechos.has(p.id);
          const omitido = omitidos.has(p.id);
          return (
            <View
              key={p.id}
              style={[
                e.segmento,
                hecho && { backgroundColor: colores.completado },
                omitido && { backgroundColor: colores.alerta },
                p.id === activo?.id && { backgroundColor: colores.marca },
              ]}
            />
          );
        })}
      </View>
      <Text style={e.progresoTexto}>
        {hechosCount} de {PASOS.length} pasos
      </Text>

      {activo ? (
        <View style={e.contenido}>
          <Text style={e.pasoTitulo}>{activo.titulo}</Text>
          <Text style={e.pasoDescripcion}>{activo.descripcion}</Text>

          <View style={e.placeholder}>
            <Text style={e.placeholderTexto}>
              El contenido de este paso llega en MAR-37/MAR-38.
            </Text>
          </View>

          <Pressable
            onPress={() =>
              setHechos((prev) => new Set(prev).add(activo.id))
            }
            style={e.boton}
            accessibilityRole="button"
          >
            <Text style={e.botonTexto}>Completar paso</Text>
          </Pressable>

          <Pressable
            onPress={() => setMostrarContingencia(true)}
            style={e.contingencia}
            accessibilityRole="button"
          >
            <Text style={e.contingenciaTexto}>No puedo completar este paso</Text>
          </Pressable>
        </View>
      ) : null}

      {activo ? (
        <ContingenciaModal
          visible={mostrarContingencia}
          paso={activo.paso}
          tituloPaso={activo.titulo}
          usuario={sesion?.user.email ?? "Mercaderista"}
          tenant_id={visita.tenant_id}
          visita_id={visitaId}
          levantamiento_id={levantamientoId}
          onRegistrada={() => setMostrarContingencia(false)}
          onCancelar={() => setMostrarContingencia(false)}
        />
      ) : null}
    </View>
  );
}

function Encabezado({
  nombre,
  onVolver,
}: {
  nombre: string;
  onVolver: () => void;
}) {
  return (
    <>
      <Pressable onPress={onVolver} hitSlop={8} style={e.volver}>
        <Text style={e.volverTexto}>‹ Marcas</Text>
      </Pressable>
      <Text style={e.titulo}>{nombre}</Text>
    </>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo, padding: espacio.m },
  centro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colores.fondo,
  },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  titulo: {
    color: colores.texto,
    fontSize: 24,
    fontWeight: "800",
    marginTop: espacio.s,
  },
  barra: { flexDirection: "row", gap: 6, marginTop: espacio.l },
  segmento: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colores.borde,
  },
  progresoTexto: {
    color: colores.textoSuave,
    fontSize: 13,
    marginTop: espacio.s,
  },
  contenido: { marginTop: espacio.l, flex: 1 },
  pasoTitulo: { color: colores.texto, fontSize: 20, fontWeight: "700" },
  pasoDescripcion: {
    color: colores.textoSuave,
    fontSize: 15,
    lineHeight: 21,
    marginTop: espacio.xs,
  },
  placeholder: {
    flex: 1,
    minHeight: 120,
    borderRadius: radio.m,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
    marginTop: espacio.l,
    padding: espacio.l,
  },
  placeholderTexto: {
    color: colores.textoSuave,
    fontSize: 14,
    textAlign: "center",
  },
  tarjeta: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.l,
    marginTop: espacio.l,
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
  botonTexto: { color: colores.marcaTexto, fontSize: 16, fontWeight: "700" },
  contingencia: { alignItems: "center", paddingVertical: espacio.m },
  contingenciaTexto: {
    color: colores.textoSuave,
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
