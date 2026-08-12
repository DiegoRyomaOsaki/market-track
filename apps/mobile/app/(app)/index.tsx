import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabase } from "@/lib/supabase";
import { olvidarDispositivo } from "@/lib/recordar-dispositivo";
import {
  type EstadoVisual,
  estadoVisual,
  horaEsperada,
  type ParadaDeHoy,
  useRuteroDeHoy,
} from "@/lib/rutero";
import {
  etiquetaDecision,
  type RevisionLocal,
  useRechazosRecientes,
} from "@/lib/revision";
import { leerTransito } from "@/lib/transito";
import { colores, espacio, radio } from "@/tema";

async function cerrarSesion() {
  await olvidarDispositivo();
  await supabase.auth.signOut();
}

function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  return fecha.toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * "Mi día": el rutero del mercaderista, leído de la réplica local. Cada tienda
 * abre su check-in. El estado por tienda se deriva de la visita (ver rutero.ts).
 */
export default function MiDia() {
  const router = useRouter();
  const { paradas, cargando, fecha } = useRuteroDeHoy();
  const rechazos = useRechazosRecientes();
  const [transitoDesde, setTransitoDesde] = useState<string | null>(null);

  // Al volver a Mi día (p. ej. tras un check-out) se relee el cronómetro de
  // tránsito: se cierra en el siguiente check-in.
  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      void leerTransito().then((d) => vivo && setTransitoDesde(d));
      return () => {
        vivo = false;
      };
    }, []),
  );

  const completadas = paradas.filter(
    (p) => estadoVisual(p.visita_estado) === "completada",
  ).length;

  return (
    <View style={e.pantalla}>
      <View style={e.encabezado}>
        <View style={{ flex: 1 }}>
          <Text style={e.titulo}>Mi día</Text>
          <Text style={e.fecha}>{fechaLarga(fecha)}</Text>
        </View>
        <Pressable
          onPress={() => void cerrarSesion()}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Text style={e.salir}>Salir</Text>
        </Pressable>
      </View>

      {paradas.length > 0 && (
        <Text style={e.progreso}>
          {completadas} de {paradas.length} visitas completadas
        </Text>
      )}

      {transitoDesde ? <BannerTransito desde={transitoDesde} /> : null}

      {rechazos.length > 0 ? <BannerRechazos rechazos={rechazos} /> : null}

      <Pressable
        onPress={() => router.push("/solicitar-cambio-ruta")}
        style={e.enlaceSolicitud}
        accessibilityRole="button"
      >
        <Text style={e.enlaceSolicitudTexto}>Solicitar cambio de ruta ›</Text>
      </Pressable>

      {cargando ? (
        <View style={e.centro}>
          <ActivityIndicator color={colores.marca} />
        </View>
      ) : paradas.length === 0 ? (
        <View style={e.centro}>
          <Text style={e.vacioTitulo}>No tienes rutero para hoy</Text>
          <Text style={e.vacioNota}>
            Cuando tu supervisor publique tu ruta, tus tiendas aparecerán aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          data={paradas}
          keyExtractor={(p) => p.parada_id}
          contentContainerStyle={{ padding: espacio.m, gap: espacio.s }}
          renderItem={({ item }) => (
            <ParadaItem
              parada={item}
              onPress={() => router.push(`/check-in/${item.parada_id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

/**
 * Los reportes que el supervisor rechazó, con su motivo.
 *
 * Va en la portada y no colgando de la parada del día porque una revisión casi
 * nunca llega el mismo día: si solo estuviera en la tienda de hoy, el
 * mercaderista no se enteraría nunca de que le rechazaron un trabajo de la semana
 * pasada. El motivo se muestra ENTERO, sin truncar: es lo único que le dice qué
 * corregir.
 */
function BannerRechazos({ rechazos }: { rechazos: RevisionLocal[] }) {
  return (
    <View style={e.rechazos} accessibilityRole="summary">
      <Text style={e.rechazosTitulo}>
        {rechazos.length === 1
          ? "1 reporte rechazado"
          : `${rechazos.length} reportes rechazados`}
      </Text>
      {rechazos.map((r) => (
        <Text key={r.visita_id} style={e.rechazosLinea}>
          {r.tienda_nombre ?? "Tienda"}
          {r.motivo ? ` — ${r.motivo}` : ""}
        </Text>
      ))}
    </View>
  );
}

function BannerTransito({ desde }: { desde: string }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seg = Math.max(
    0,
    Math.floor((ahora - new Date(desde).getTime()) / 1000),
  );
  const mm = String(Math.floor(seg / 60)).padStart(2, "0");
  const ss = String(seg % 60).padStart(2, "0");
  return (
    <View style={e.transito} accessibilityRole="summary">
      <Text style={e.transitoTexto}>
        En tránsito · {mm}:{ss}
      </Text>
      <Text style={e.transitoNota}>Se registra al hacer check-in</Text>
    </View>
  );
}

function ParadaItem({
  parada,
  onPress,
}: {
  parada: ParadaDeHoy;
  onPress: () => void;
}) {
  const estado = estadoVisual(parada.visita_estado);
  const hora = horaEsperada(parada.hora_planificada);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // La revisión entra en la etiqueta: con un lector de pantalla, el chip de
      // "Rechazado" es invisible y quedaría solo "Completada". La hora esperada,
      // por lo mismo: en pantalla es un número gris junto al nombre.
      accessibilityLabel={[
        parada.tienda_nombre,
        hora ? `se espera a las ${hora}` : null,
        ETIQUETA[estado],
        parada.revision_decision
          ? etiquetaDecision(parada.revision_decision)
          : null,
      ]
        .filter(Boolean)
        .join(", ")}
      style={({ pressed }) => [e.card, pressed && { opacity: 0.7 }]}
    >
      <View style={e.orden}>
        <Text style={e.ordenTexto}>{parada.orden}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={e.tienda} numberOfLines={1}>
          {parada.tienda_nombre}
        </Text>
        {/* Informativa, nunca bloqueante: llegar tarde no impide fichar. */}
        {hora ? (
          <Text style={e.horaEsperada}>Se espera a las {hora}</Text>
        ) : null}
        {parada.tienda_direccion ? (
          <Text style={e.direccion} numberOfLines={1}>
            {parada.tienda_direccion}
          </Text>
        ) : null}
      </View>
      {parada.revision_decision ? (
        <Text
          style={[
            e.revision,
            parada.revision_decision === "rechazada" && {
              color: colores.alertaTexto,
            },
          ]}
        >
          {etiquetaDecision(parada.revision_decision)}
        </Text>
      ) : null}
      <Semaforo estado={estado} />
    </Pressable>
  );
}

const ETIQUETA: Record<EstadoVisual, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  completada: "Completada",
};

const COLOR: Record<EstadoVisual, string> = {
  pendiente: colores.textoSuave,
  en_curso: colores.marca,
  completada: colores.completado,
};

function Semaforo({ estado }: { estado: EstadoVisual }) {
  return (
    <View style={e.chip}>
      <View style={[e.punto, { backgroundColor: COLOR[estado] }]} />
      <Text style={[e.chipTexto, { color: COLOR[estado] }]}>
        {ETIQUETA[estado]}
      </Text>
    </View>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  encabezado: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: espacio.m,
    paddingTop: espacio.m,
    gap: espacio.m,
  },
  titulo: { color: colores.texto, fontSize: 26, fontWeight: "800" },
  fecha: {
    color: colores.textoSuave,
    fontSize: 14,
    marginTop: 2,
    textTransform: "capitalize",
  },
  salir: { color: colores.textoSuave, fontSize: 14, fontWeight: "600" },
  progreso: {
    color: colores.textoSuave,
    fontSize: 13,
    paddingHorizontal: espacio.m,
    marginTop: espacio.s,
  },
  transito: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: espacio.m,
    marginTop: espacio.s,
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.s,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.marca,
    backgroundColor: colores.superficie,
  },
  transitoTexto: { color: colores.texto, fontSize: 14, fontWeight: "700" },
  transitoNota: { color: colores.textoSuave, fontSize: 12 },
  rechazos: {
    marginHorizontal: espacio.m,
    marginTop: espacio.s,
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.s,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.alerta,
    backgroundColor: colores.superficie,
    gap: espacio.xs,
  },
  rechazosTitulo: {
    color: colores.alertaTexto,
    fontSize: 14,
    fontWeight: "700",
  },
  rechazosLinea: { color: colores.texto, fontSize: 13 },
  revision: { color: colores.textoSuave, fontSize: 11, fontWeight: "700" },
  enlaceSolicitud: {
    marginHorizontal: espacio.m,
    marginTop: espacio.s,
    paddingVertical: espacio.xs,
  },
  enlaceSolicitudTexto: {
    color: colores.marca,
    fontSize: 14,
    fontWeight: "600",
  },
  centro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: espacio.xl,
    gap: espacio.s,
  },
  vacioTitulo: { color: colores.texto, fontSize: 17, fontWeight: "700" },
  vacioNota: {
    color: colores.textoSuave,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: espacio.m,
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.m,
  },
  orden: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colores.fondo,
    borderWidth: 1,
    borderColor: colores.borde,
    alignItems: "center",
    justifyContent: "center",
  },
  ordenTexto: { color: colores.textoSuave, fontSize: 14, fontWeight: "700" },
  tienda: { color: colores.texto, fontSize: 16, fontWeight: "600" },
  direccion: { color: colores.textoSuave, fontSize: 13, marginTop: 2 },
  horaEsperada: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  chip: { flexDirection: "row", alignItems: "center", gap: 6 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  chipTexto: { fontSize: 12, fontWeight: "700" },
});
