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
import { PasoAntesSos } from "@/componentes/paso-antes-sos";
import {
  completarLevantamiento,
  crearLevantamiento,
  useContingencias,
  useLevantamiento,
  useMarcasDeVisita,
  useVisita,
} from "@/lib/levantamiento";
import {
  levantamientoCompleto,
  type PasoWizard,
  PASOS,
} from "@/lib/pasos-levantamiento";
import { useSesion } from "@/sesion";
import { colores, espacio, radio } from "@/tema";

// El shell del wizard de levantamiento de una marca: navegación secuencial de
// los 5 pasos, barra de progreso y contingencia (bypass) en cada paso.
//
// Paso 1 "Antes + Share of Shelf" ya es real (MAR-37, PasoAntesSos) y su avance
// se DERIVA de datos persistidos. Los pasos 2–5 (quiebres, precios,
// exhibiciones, Después) siguen como marcador provisional hasta MAR-38, con el
// avance en estado de sesión. Los pasos omitidos por contingencia se persisten
// (tabla `contingencia`).

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
  const lev = useLevantamiento(levantamientoId);

  const [hechosSesion, setHechosSesion] = useState<ReadonlySet<string>>(
    new Set(),
  );
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

  // "antes" se deriva de datos persistidos (el SOS quedó guardado): así el paso
  // sobrevive a un cierre de la app. Los pasos aún sin implementar usan estado de
  // sesión hasta que MAR-38 dé datos que derivar.
  const hechos = useMemo(() => {
    const s = new Set(hechosSesion);
    if (lev?.sos_frentes_propios != null) s.add("antes");
    return s;
  }, [hechosSesion, lev]);

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
          {activo.id === "antes" ? (
            <PasoAntesSos
              visitaId={visitaId}
              marcaId={marcaId}
              levantamientoId={levantamientoId}
              tenantId={visita.tenant_id}
              usuario={sesion?.user.email ?? "Mercaderista"}
              onContingencia={() => setMostrarContingencia(true)}
            />
          ) : (
            <PasoPlaceholder
              paso={activo}
              onCompletar={() =>
                setHechosSesion((prev) => new Set(prev).add(activo.id))
              }
              onContingencia={() => setMostrarContingencia(true)}
            />
          )}
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

// Los pasos aún sin contenido real (quiebres/precios/exhibiciones/Después) los
// implementa MAR-38. Hasta entonces, "Completar" avanza en sesión y la
// contingencia sigue disponible.
function PasoPlaceholder({
  paso,
  onCompletar,
  onContingencia,
}: {
  paso: PasoWizard;
  onCompletar: () => void;
  onContingencia: () => void;
}) {
  return (
    <>
      <Text style={e.pasoTitulo}>{paso.titulo}</Text>
      <Text style={e.pasoDescripcion}>{paso.descripcion}</Text>

      <View style={e.placeholder}>
        <Text style={e.placeholderTexto}>
          El contenido de este paso llega en MAR-38.
        </Text>
      </View>

      <Pressable onPress={onCompletar} style={e.boton} accessibilityRole="button">
        <Text style={e.botonTexto}>Completar paso</Text>
      </Pressable>

      <Pressable
        onPress={onContingencia}
        style={e.contingencia}
        accessibilityRole="button"
      >
        <Text style={e.contingenciaTexto}>No puedo completar este paso</Text>
      </Pressable>
    </>
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
