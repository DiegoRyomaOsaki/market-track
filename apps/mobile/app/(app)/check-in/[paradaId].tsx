import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AyudaBoton } from "@/componentes/ayuda-boton";
import { CamaraFoto } from "@/componentes/camara-foto";
import { colaFotos } from "@/lib/cola-fotos-instancia";
import { type FotoProcesada } from "@/lib/foto-captura";
import { dentroDeGeocerca, distanciaMetros } from "@/lib/geo";
import { useParada } from "@/lib/rutero";
import {
  leerTransito,
  limpiarTransito,
  minutosDeTraslado,
} from "@/lib/transito";
import { type ResultadoUbicacion, ubicacionActual } from "@/lib/ubicacion";
import { crearVisitaCheckIn } from "@/lib/visita";
import { useSesion } from "@/sesion";
import { colores, espacio, radio } from "@/tema";

// Check-in geocercado + selfie con watermark. La geocerca del cliente es SOLO UX
// (se puede hacer check-in fuera de radio); el servidor re-valida al sincronizar
// (MAR-30). La selfie se captura con watermark y se encola; enlazarla a la visita
// (fila `foto` + subida a R2) es MAR-39.

export default function CheckIn() {
  const router = useRouter();
  const sesion = useSesion();
  const { paradaId } = useLocalSearchParams<{ paradaId: string }>();
  const { parada, cargando } = useParada(paradaId);

  const [paso, setPaso] = useState<"form" | "camara">("form");
  const [ubic, setUbic] = useState<ResultadoUbicacion | null>(null);
  const [ubicando, setUbicando] = useState(true);
  const [foto, setFoto] = useState<FotoProcesada | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void ubicacionActual().then((r) => {
      setUbic(r);
      setUbicando(false);
    });
  }, []);

  if (cargando) {
    return (
      <View style={e.centro}>
        <ActivityIndicator color={colores.marca} />
      </View>
    );
  }

  if (!parada) {
    return (
      <View style={e.centro}>
        <Text style={e.aviso}>No se encontró la tienda.</Text>
        <Pressable onPress={() => router.back()} style={e.botonSec}>
          <Text style={e.botonSecTexto}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  const yaHizoCheckIn = parada.visita_id != null;

  if (paso === "camara" && sesion) {
    return (
      <CamaraFoto
        usuario={sesion.user.email ?? "Mercaderista"}
        lat={ubic?.ok ? ubic.punto.lat : 0}
        lng={ubic?.ok ? ubic.punto.lng : 0}
        etiqueta="Tomar selfie"
        onListo={(f) => {
          setFoto(f);
          setPaso("form");
        }}
        onCancelar={() => setPaso("form")}
      />
    );
  }

  async function confirmar() {
    if (!parada || !sesion || !ubic?.ok || !foto) return;
    setGuardando(true);
    try {
      const ahora = new Date().toISOString();
      const fotoId = Crypto.randomUUID();
      // La selfie se persiste en la cola; la subida a R2 y la fila `foto` son MAR-39.
      await colaFotos.encolar({
        id: fotoId,
        ruta: foto.ruta,
        hash: foto.hash,
        encolada_at: ahora,
      });
      // Cierra el cronómetro de tránsito de la tienda anterior: sus minutos son
      // el traslado HACIA esta visita.
      const trasladoDesde = await leerTransito();
      const tiempoTraslado = trasladoDesde
        ? minutosDeTraslado(trasladoDesde, ahora)
        : null;
      if (trasladoDesde) await limpiarTransito();
      const visitaId = await crearVisitaCheckIn({
        tenant_id: parada.tenant_id,
        rutero_parada_id: parada.parada_id,
        tienda_id: parada.tienda_id,
        mercaderista_id: sesion.user.id,
        punto: ubic.punto,
        capturado_at: ahora,
        selfie_foto_id: null,
        tiempo_traslado_min: tiempoTraslado,
      });
      // El levantamiento por marca es el siguiente paso; `replace` deja el
      // check-in fuera de la pila (volver desde el selector regresa a Mi día).
      router.replace(`/levantamiento/${visitaId}`);
    } finally {
      setGuardando(false);
    }
  }

  const geocerca = ubic?.ok
    ? dentroDeGeocerca(ubic.punto, {
        lat: parada.lat,
        lon: parada.lon,
        radio_m: parada.radio_geocerca_m,
      })
    : null;

  const distancia =
    ubic?.ok && parada.lat != null && parada.lon != null
      ? Math.round(
          distanciaMetros(
            ubic.punto.lat,
            ubic.punto.lng,
            parada.lat,
            parada.lon,
          ),
        )
      : null;

  return (
    <View style={e.pantalla}>
      <Pressable onPress={() => router.back()} hitSlop={8} style={e.volver}>
        <Text style={e.volverTexto}>‹ Mi día</Text>
      </Pressable>

      <View style={e.tituloFila}>
        <View style={{ flex: 1 }}>
          <Text style={e.tienda}>{parada.tienda_nombre}</Text>
          {parada.tienda_direccion ? (
            <Text style={e.direccion}>{parada.tienda_direccion}</Text>
          ) : null}
        </View>
        <AyudaBoton clave="check_in" />
      </View>

      {yaHizoCheckIn ? (
        <View style={e.tarjeta}>
          <Text style={[e.estado, { color: colores.completado }]}>
            ✓ Check-in realizado
          </Text>
          <Text style={e.nota}>
            El levantamiento por marca es el siguiente paso.
          </Text>
          <Pressable
            onPress={() => router.push(`/levantamiento/${parada.visita_id}`)}
            style={e.boton}
            accessibilityRole="button"
          >
            <Text style={e.botonTexto}>Ir al levantamiento</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Seccion titulo="Ubicación">
            {ubicando ? (
              <Fila>
                <ActivityIndicator color={colores.marca} size="small" />
                <Text style={e.filaTexto}>Ubicándote…</Text>
              </Fila>
            ) : ubic?.ok ? (
              <Fila>
                <Punto
                  color={
                    geocerca === false ? colores.alerta : colores.completado
                  }
                />
                <Text style={e.filaTexto}>
                  {geocerca === null
                    ? "Sin ubicación registrada de la tienda"
                    : geocerca
                      ? "Estás en la tienda"
                      : `Fuera del radio${distancia != null ? ` (a ${distancia} m)` : ""}`}
                </Text>
              </Fila>
            ) : (
              <Fila>
                <Punto color={colores.alerta} />
                <Text style={e.filaTexto}>
                  {ubic?.motivo === "permiso"
                    ? "Sin permiso de ubicación"
                    : "No se pudo obtener la ubicación"}
                </Text>
              </Fila>
            )}
            {geocerca === false ? (
              <Text style={e.notaAlerta}>
                Puedes continuar; tu supervisor verá que fue fuera del radio.
              </Text>
            ) : null}
          </Seccion>

          <Seccion titulo="Selfie de check-in">
            <Fila>
              <Punto color={foto ? colores.completado : colores.textoSuave} />
              <Text style={e.filaTexto}>
                {foto ? "Selfie tomada" : "Toma tu selfie (obligatoria)"}
              </Text>
            </Fila>
            <Pressable
              onPress={() => setPaso("camara")}
              style={e.botonSec}
              accessibilityRole="button"
            >
              <Text style={e.botonSecTexto}>
                {foto ? "Repetir selfie" : "Abrir cámara"}
              </Text>
            </Pressable>
          </Seccion>

          <Pressable
            onPress={() => void confirmar()}
            disabled={!ubic?.ok || !foto || guardando}
            style={[
              e.boton,
              (!ubic?.ok || !foto || guardando) && e.botonInactivo,
            ]}
            accessibilityRole="button"
          >
            {guardando ? (
              <ActivityIndicator color={colores.marcaTexto} />
            ) : (
              <Text style={e.botonTexto}>Confirmar check-in</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

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

const Fila = ({ children }: { children: React.ReactNode }) => (
  <View style={e.fila}>{children}</View>
);

const Punto = ({ color }: { color: string }) => (
  <View style={[e.punto, { backgroundColor: color }]} />
);

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo, padding: espacio.m },
  centro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: espacio.xl,
    gap: espacio.l,
    backgroundColor: colores.fondo,
  },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  tituloFila: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: espacio.s,
    marginTop: espacio.s,
  },
  tienda: {
    color: colores.texto,
    fontSize: 24,
    fontWeight: "800",
  },
  direccion: { color: colores.textoSuave, fontSize: 14, marginTop: 2 },
  tarjeta: {
    backgroundColor: colores.superficie,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espacio.l,
    marginTop: espacio.l,
    gap: espacio.s,
  },
  estado: { fontSize: 18, fontWeight: "700" },
  nota: { color: colores.textoSuave, fontSize: 14, lineHeight: 20 },
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
  filaTexto: { color: colores.texto, fontSize: 15, flex: 1 },
  punto: { width: 10, height: 10, borderRadius: 5 },
  notaAlerta: { color: colores.textoSuave, fontSize: 13, lineHeight: 18 },
  aviso: { color: colores.texto, fontSize: 15, textAlign: "center" },
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
});
