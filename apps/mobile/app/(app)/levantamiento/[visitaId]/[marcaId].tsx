import { type ClaveAyuda } from "@market-track/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AyudaBoton } from "@/componentes/ayuda-boton";
import { ContingenciaModal } from "@/componentes/contingencia-modal";
import { PasoAntesSos } from "@/componentes/paso-antes-sos";
import { PasoConfigurable } from "@/componentes/paso-configurable";
import { PasoDespues } from "@/componentes/paso-despues";
import { PasoExhibiciones } from "@/componentes/paso-exhibiciones";
import { PasoPrecios } from "@/componentes/paso-precios";
import { PasoQuiebres } from "@/componentes/paso-quiebres";
import {
  completarLevantamiento,
  crearLevantamiento,
  useContingencias,
  useDefinicionAnclada,
  useLevantamiento,
  useMarcasDeVisita,
  useVisita,
} from "@/lib/levantamiento";
import {
  construirPasos,
  levantamientoCompleto,
  type PasoWizard,
} from "@/lib/pasos-levantamiento";
import { useSesion } from "@/sesion";
import { colores, espacio, radio } from "@/tema";

// El shell del wizard de levantamiento de una marca: navegación secuencial de
// los pasos, barra de progreso y contingencia (bypass) en cada paso. Los pasos
// se construyen de los 5 fijos (MAR-36/37/38) más los CONFIGURABLES de la
// definición anclada al levantamiento (MAR-80), entre "exhibiciones" y "despues".
//
// "Antes + Share of Shelf" (MAR-37) deriva su avance de datos persistidos; los
// pasos de quiebres/precios/exhibiciones/Después (MAR-38) y los configurables
// avanzan en sesión al completar. Los pasos omitidos por contingencia se
// persisten (tabla `contingencia`).

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
  const definicion = useDefinicionAnclada(levantamientoId);
  const pasos = useMemo(() => construirPasos(definicion), [definicion]);

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
    const ids = new Set<string>();
    for (const c of contingencias) {
      // Un paso configurable se identifica por su id (paso_config_id); un paso
      // fijo, por el valor de enum que comparte con el paso del wizard.
      if (c.paso_config_id) {
        ids.add(c.paso_config_id);
        continue;
      }
      const fijo = pasos.find((p) => p.tipo === "fijo" && p.paso === c.paso);
      if (fijo) ids.add(fijo.id);
    }
    return ids;
  }, [contingencias, pasos]);

  // "antes" se deriva de datos persistidos (el SOS quedó guardado): así el paso
  // sobrevive a un cierre de la app. Los pasos aún sin implementar usan estado de
  // sesión hasta que MAR-38 dé datos que derivar.
  const hechos = useMemo(() => {
    const s = new Set(hechosSesion);
    if (lev?.sos_frentes_propios != null) s.add("antes");
    return s;
  }, [hechosSesion, lev]);

  const completo = levantamientoCompleto(pasos, hechos, omitidos);
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

  const activo =
    pasos.find((p) => !hechos.has(p.id) && !omitidos.has(p.id)) ?? null;
  const hechosCount = pasos.filter(
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
        // Solo los pasos FIJOS tienen ayuda contextual: sus ids son un
        // subconjunto de ClaveAyuda. Los configurables llevan su ayuda por campo.
        clave={activo?.tipo === "fijo" ? activo.id : undefined}
        onVolver={() => router.replace(`/levantamiento/${visitaId}`)}
      />

      <View style={e.barra}>
        {pasos.map((p) => {
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
        {hechosCount} de {pasos.length} pasos
      </Text>

      {activo ? (
        <View style={e.contenido}>
          <PasoActivo
            // Remonta al cambiar de paso: cada paso (incluidos varios
            // configurables seguidos, que comparten componente) arranca con su
            // propio estado y su propia siembra, sin heredar la del anterior.
            key={activo.id}
            paso={activo}
            visitaId={visitaId}
            marcaId={marcaId}
            levantamientoId={levantamientoId}
            tenantId={visita.tenant_id}
            usuario={sesion?.user.email ?? "Mercaderista"}
            onCompletar={() =>
              setHechosSesion((prev) => new Set(prev).add(activo.id))
            }
            onContingencia={() => setMostrarContingencia(true)}
          />
        </View>
      ) : null}

      {activo ? (
        <ContingenciaModal
          visible={mostrarContingencia}
          paso={activo.paso}
          pasoConfigId={activo.tipo === "configurable" ? activo.id : null}
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

// Despacha al componente de cada paso. "antes" no usa onCompletar: su avance se
// deriva de datos persistidos; los demás (fijos y configurables) avanzan en
// sesión al completar.
function PasoActivo({
  paso,
  visitaId,
  marcaId,
  levantamientoId,
  tenantId,
  usuario,
  onCompletar,
  onContingencia,
}: {
  paso: PasoWizard;
  visitaId: string;
  marcaId: string;
  levantamientoId: string;
  tenantId: string;
  usuario: string;
  onCompletar: () => void;
  onContingencia: () => void;
}) {
  if (paso.tipo === "configurable") {
    return (
      <PasoConfigurable
        paso={paso}
        levantamientoId={levantamientoId}
        tenantId={tenantId}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }

  const comun = { visitaId, marcaId, levantamientoId, tenantId };
  if (paso.id === "antes") {
    return (
      <PasoAntesSos
        {...comun}
        usuario={usuario}
        onContingencia={onContingencia}
      />
    );
  }
  if (paso.id === "quiebres") {
    return (
      <PasoQuiebres
        {...comun}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }
  if (paso.id === "precios") {
    return (
      <PasoPrecios
        {...comun}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }
  if (paso.id === "exhibiciones") {
    return (
      <PasoExhibiciones
        {...comun}
        usuario={usuario}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }
  return (
    <PasoDespues
      {...comun}
      usuario={usuario}
      onCompletar={onCompletar}
      onContingencia={onContingencia}
    />
  );
}

function Encabezado({
  nombre,
  clave,
  onVolver,
}: {
  nombre: string;
  clave?: ClaveAyuda;
  onVolver: () => void;
}) {
  return (
    <>
      <Pressable onPress={onVolver} hitSlop={8} style={e.volver}>
        <Text style={e.volverTexto}>‹ Marcas</Text>
      </Pressable>
      <View style={e.tituloFila}>
        <Text style={e.titulo}>{nombre}</Text>
        {clave ? <AyudaBoton clave={clave} /> : null}
      </View>
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
    flex: 1,
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
  tarjeta: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.l,
    marginTop: espacio.l,
  },
  estado: { fontSize: 18, fontWeight: "700" },
});
