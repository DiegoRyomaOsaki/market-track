import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { diaEnLima, etiquetaDePeriodo } from "@market-track/shared";

import { Banner } from "@/componentes/banner";
import {
  etiquetaDeDesempeno,
  TarjetaDesempeno,
} from "@/componentes/tarjeta-desempeno";
import {
  fechaCorta,
  formatearPct,
  textoDeMiPosicion,
  useMiDesempeno,
} from "@/lib/desempeno";
import { cerrarSesion } from "@/lib/cierre-sesion";
import {
  type AvisoDeRetiro,
  avisosDeRetiro,
  descartarRetiro,
  leerDescartes,
  useRetirosDeHoy,
} from "@/lib/paradas-retiradas";
import {
  type EstadoVisual,
  estadoVisual,
  horaEsperada,
  type ParadaDeHoy,
  type UltimaVisita,
  ultimaVisitaAjena,
  useRuteroDeHoy,
  useUltimaVisitaPorTienda,
} from "@/lib/rutero";
import {
  etiquetaDecision,
  type RevisionLocal,
  useRechazosRecientes,
} from "@/lib/revision";
import { leerTransito } from "@/lib/transito";
import { colores, espacio, radio } from "@/tema";

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
  const { visitas: ultimasVisitas } = useUltimaVisitaPorTienda(
    // Acotada a las tiendas de HOY: `visita` se replica sin cota de fecha y
    // barrer el historial entero en SQLite, en cada render, crece con los años
    // de servicio del mercaderista.
    useMemo(() => paradas.map((p) => p.tienda_id), [paradas]),
  );
  const hoyLima = useMemo(() => diaEnLima(new Date()), []);
  const desempeno = useMiDesempeno(hoyLima);
  const [transitoDesde, setTransitoDesde] = useState<string | null>(null);

  // Las tiendas que el supervisor quitó de la ruta. Se leen de la réplica con
  // la MISMA fecha que el rutero: dos relojes distintos cerca de medianoche
  // dirían cosas contradictorias en esta misma pantalla.
  const retiros = useRetirosDeHoy(fecha);
  const [descartados, setDescartados] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    let vivo = true;
    void leerDescartes(fecha).then((d) => vivo && setDescartados(d));
    return () => {
      vivo = false;
    };
  }, [fecha]);

  // El aviso se calcula contra las paradas VIVAS: una tienda que sigue en la
  // ruta no se anuncia como perdida. `useQuery` repinta con el mismo
  // checkpoint que borra la parada, así que la baja que llega a mitad de
  // jornada aparece sola, sin reabrir la app.
  const avisosRetiro = useMemo(
    () =>
      avisosDeRetiro(
        retiros.retiradas,
        descartados,
        new Set(paradas.map((p) => p.tienda_id)),
      ),
    [retiros.retiradas, descartados, paradas],
  );

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
        {/* Sin `hitSlop`: ampliaba el área tocable con superficie INVISIBLE
            pegada al título, en la pantalla por donde más veces pasa un pulgar.
            Ahora el área que dispara el cierre es exactamente la que se ve. */}
        <Pressable
          onPress={() => void cerrarSesion()}
          accessibilityRole="button"
          accessibilityLabel="Salir, cerrar sesión"
          accessibilityHint="Pide confirmación antes de salir"
          style={({ pressed }) => [e.salir, pressed && { opacity: 0.6 }]}
        >
          <Text style={e.salirTexto}>Salir</Text>
        </Pressable>
      </View>

      {/* Lo primero que el cliente describió: "yo entro a mi sesión, veo mi
          puntaje, veo mi ruta con las tiendas que tengo que visitar". Por eso
          va en la portada y no solo detrás de un toque.

          Un fallo de la consulta local NO se calla: sin este aviso, la tarjeta
          simplemente no se pinta y eso se lee como "todavía no tienes puntaje",
          que es justo la conclusión equivocada. */}
      {desempeno.error ? (
        <Text style={e.avisoDesempeno} accessibilityRole="alert">
          No se pudo leer tu puntaje. Vuelve a abrir la app.
        </Text>
      ) : desempeno.actual ? (
        <Link href="/mi-desempeno" asChild>
          <Pressable
            accessibilityRole="button"
            // La etiqueta va AQUÍ y la tarjeta cede la suya: dos nodos accesibles
            // anidados se comportan distinto en TalkBack y en VoiceOver — uno se
            // traga al de dentro (y se pierden el puntaje y la posición) y el
            // otro obliga a un gesto extra para entrar en el grupo.
            accessibilityLabel={etiquetaDeDesempeno({
              etiquetaPeriodo: etiquetaDePeriodo(
                desempeno.tipo,
                desempeno.actual.periodo_inicio,
              ),
              totalPct: desempeno.actual.total_pct,
              puesto: textoDeMiPosicion(
                desempeno.actual.posicion,
                desempeno.actual.mercaderistas_evaluados,
                desempeno.actual.hay_empate === 1,
              ),
              estado:
                desempeno.actual.cerrado_at !== null ? "Cerrado" : "En curso",
            })}
            accessibilityHint="Abre el detalle de tu puntaje"
            style={({ pressed }) => [
              e.enlaceDesempeno,
              pressed && { opacity: 0.7 },
            ]}
          >
            <TarjetaDesempeno
              compacta
              dentroDeUnBoton
              etiquetaPeriodo={etiquetaDePeriodo(
                desempeno.tipo,
                desempeno.actual.periodo_inicio,
              )}
              totalPct={desempeno.actual.total_pct}
              posicion={desempeno.actual.posicion}
              evaluados={desempeno.actual.mercaderistas_evaluados}
              hayEmpate={desempeno.actual.hay_empate === 1}
              cerrado={desempeno.actual.cerrado_at !== null}
            />
          </Pressable>
        </Link>
      ) : null}

      {paradas.length > 0 && (
        <Text style={e.progreso}>
          {completadas} de {paradas.length} visitas completadas
        </Text>
      )}

      {transitoDesde ? <BannerTransito desde={transitoDesde} /> : null}

      {rechazos.length > 0 ? <BannerRechazos rechazos={rechazos} /> : null}

      {/* La región viva se monta desde el PRIMER render y solo cambia su
          contenido: montarla junto con el aviso lo anunciaría en el mismo
          instante en que se inserta, y algunos lectores se lo pierden.
          (`accessibilityLiveRegion` es solo de Android; en iOS no se anuncia
          solo. No es lo que cubre la baja que llega a mitad de jornada —eso
          lo cubre que el aviso PERSISTA—, es un extra.)

          Y un fallo de la consulta NO se calla: sin este aviso, la ausencia
          de banner se lee como "no te quitaron nada", que es justo la
          conclusión contraria. */}
      <View accessibilityLiveRegion="polite">
        {retiros.error ? (
          <Text style={e.avisoDesempeno} accessibilityRole="alert">
            No se pudo comprobar si cambió tu ruta. Vuelve a abrir la app.
          </Text>
        ) : avisosRetiro.length > 0 ? (
          <BannerRetiros
            avisos={avisosRetiro}
            onDescartar={(id) => {
              void descartarRetiro(id, fecha).then(setDescartados);
            }}
          />
        ) : null}
      </View>

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
              ultima={ultimaVisitaAjena(
                ultimasVisitas,
                item.tienda_id,
                item.parada_id,
              )}
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
    <Banner color={colores.alerta}>
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
    </Banner>
  );
}

/**
 * Las tiendas que salieron de la ruta de hoy.
 *
 * Va ARRIBA y fuera de la lista, no como fila fantasma dentro de ella: una
 * tienda que ya no es suya no debe invitar a tocarla y mandarlo a un check-in
 * imposible. El motivo se muestra entero, sin truncar, por lo mismo que en el
 * banner de rechazos: es lo único que le explica qué pasó.
 */
function BannerRetiros({
  avisos,
  onDescartar,
}: {
  avisos: AvisoDeRetiro[];
  onDescartar: (id: string) => void;
}) {
  return (
    <Banner color={colores.ambar}>
      {/* El significado va en el TEXTO, nunca en el color del borde. */}
      <Text style={e.retirosTitulo}>
        {avisos.length === 1
          ? "1 tienda salió de tu ruta de hoy"
          : `${avisos.length} tiendas salieron de tu ruta de hoy`}
      </Text>
      {avisos.map((a) => (
        <View key={a.id} style={e.retiroFila}>
          <Text style={e.retirosLinea}>
            {a.tienda} · {fechaCorta(a.retirada_at)}
            {a.motivo ? `\nMotivo: ${a.motivo}` : ""}
          </Text>
          {/* "Entendido" y no una "✕": un glifo suelto es significado por
              icono, y además es un blanco pequeño. La etiqueta nombra la
              tienda porque tres botones "Entendido" seguidos son
              indistinguibles con un lector de pantalla. */}
          <Pressable
            onPress={() => onDescartar(a.id)}
            accessibilityRole="button"
            accessibilityLabel={`Entendido, ocultar el aviso de ${a.tienda}`}
            style={({ pressed }) => [
              e.retiroBoton,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={e.retiroBotonTexto}>Entendido</Text>
          </Pressable>
        </View>
      ))}
    </Banner>
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
    <Banner color={colores.marca} style={e.transitoFila}>
      <Text style={e.transitoTexto}>
        En tránsito · {mm}:{ss}
      </Text>
      <Text style={e.transitoNota}>Se registra al hacer check-in</Text>
    </Banner>
  );
}

function ParadaItem({
  parada,
  ultima,
  onPress,
}: {
  parada: ParadaDeHoy;
  /** La última visita a esta tienda que NO sea la de hoy. */
  ultima: UltimaVisita | null;
  onPress: () => void;
}) {
  const estado = estadoVisual(parada.visita_estado);
  const hora = horaEsperada(parada.hora_planificada);
  const historial = textoHistorial(ultima);
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
        historial,
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
        {/* "…la última vez no estuvo tan bien, entonces hoy voy y la dejo
            perfecta". Es el motivo entero de la pantalla. */}
        {historial ? <Text style={e.historial}>{historial}</Text> : null}
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

/**
 * "12 ago · Perfect Store 78,0" — el historial de la tienda en una línea.
 *
 * Nunca dice "0" cuando no hubo puntaje: un cero se lee como "la dejaste
 * fatal" y la verdad es que no se evaluó.
 */
function textoHistorial(ultima: UltimaVisita | null): string | null {
  if (ultima === null) return null;
  const cuando = fechaCorta(ultima.check_out_at);
  if (ultima.perfect_store_pct === null) {
    return `Última visita: ${cuando} · sin puntaje`;
  }
  return `Última visita: ${cuando} · Perfect Store ${formatearPct(ultima.perfect_store_pct)}`;
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
  enlaceDesempeno: { paddingHorizontal: espacio.m, paddingTop: espacio.s },
  avisoDesempeno: {
    color: colores.alertaTexto,
    fontSize: 13,
    paddingHorizontal: espacio.m,
    paddingTop: espacio.s,
  },
  historial: { color: colores.textoSuave, fontSize: 12, marginTop: 2 },
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
  salir: {
    // 48 y no 44: es la guía de Android, que es la plataforma de campo, y este
    // botón se pulsa de pie y con una mano.
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: espacio.s,
    borderWidth: 1,
    // `textoSuave` y no `borde` para el contorno: `borde` da 1,45:1 contra el
    // fondo —invisible bajo el sol— y el sentido de este borde es justamente
    // que se VEA dónde empieza el área que cierra la sesión. Este da 6,97:1.
    borderColor: colores.textoSuave,
    borderRadius: radio.m,
  },
  salirTexto: { color: colores.textoSuave, fontSize: 14, fontWeight: "600" },
  progreso: {
    color: colores.textoSuave,
    fontSize: 13,
    paddingHorizontal: espacio.m,
    marginTop: espacio.s,
  },
  transitoFila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  transitoTexto: { color: colores.texto, fontSize: 14, fontWeight: "700" },
  transitoNota: { color: colores.textoSuave, fontSize: 12 },
  rechazosTitulo: {
    color: colores.alertaTexto,
    fontSize: 14,
    fontWeight: "700",
  },
  rechazosLinea: { color: colores.texto, fontSize: 13 },
  // `colores.texto` y no `ambar` para el título: ese token es de relleno y
  // borde. El mismo razonamiento que separó `alerta` de `alertaTexto`.
  retirosTitulo: { color: colores.texto, fontSize: 14, fontWeight: "700" },
  retiroFila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: espacio.s,
  },
  retirosLinea: { color: colores.texto, fontSize: 13, flex: 1 },
  retiroBoton: {
    // 48 y no 44: es la guía de Android, que es la plataforma de campo.
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: espacio.s,
    borderWidth: 1,
    borderColor: colores.textoSuave,
    borderRadius: radio.m,
  },
  retiroBotonTexto: {
    color: colores.textoSuave,
    fontSize: 14,
    fontWeight: "600",
  },
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
