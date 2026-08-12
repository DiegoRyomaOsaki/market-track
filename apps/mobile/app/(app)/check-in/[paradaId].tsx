import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AyudaBoton } from "@/componentes/ayuda-boton";
import { CamaraFoto } from "@/componentes/camara-foto";
import { ControlCampo } from "@/componentes/campo-configurable";
import {
  puedeConfirmarCheckIn,
  respuestasDeCheckIn,
  useFormularioCheckIn,
} from "@/lib/check-in";
import { encolarFoto } from "@/lib/cola-fotos-instancia";
import { mensajeDeError } from "@/lib/error";
import { type FotoCapturada } from "@/lib/foto-captura";
import { fotosPorEncolar, type RespuestaCruda } from "@/lib/formulario";
import { dentroDeGeocerca, distanciaMetros } from "@/lib/geo";
import { useParada } from "@/lib/rutero";
import {
  leerTransito,
  limpiarTransito,
  minutosDeTraslado,
} from "@/lib/transito";
import { type ResultadoUbicacion, ubicacionActual } from "@/lib/ubicacion";
import { crearVisitaCheckIn, guardarRespuestasVisita } from "@/lib/visita";
import { useSesion } from "@/sesion";
import { colores, espacio, radio } from "@/tema";

// Check-in geocercado + selfie con watermark + checklist configurable (MAR-98).
// La geocerca del cliente es SOLO UX (se puede hacer check-in fuera de radio); el
// servidor re-valida al sincronizar (MAR-30). El checklist NUNCA bloquea el
// check-in: se registra lo que haya y afecta al puntaje, no al flujo.

type Camara = { clase: "selfie" } | { clase: "campo"; campoId: string };

export default function CheckIn() {
  const router = useRouter();
  const sesion = useSesion();
  const { paradaId } = useLocalSearchParams<{ paradaId: string }>();
  const { parada, cargando } = useParada(paradaId);
  const { versionId, campos } = useFormularioCheckIn(parada?.tenant_id ?? null);

  const [camara, setCamara] = useState<Camara | null>(null);
  const [ubic, setUbic] = useState<ResultadoUbicacion | null>(null);
  const [ubicando, setUbicando] = useState(true);
  const [foto, setFoto] = useState<FotoCapturada | null>(null);
  const [valores, setValores] = useState<Record<string, RespuestaCruda>>({});
  const [fotosPendientes, setFotosPendientes] = useState<
    Record<string, FotoCapturada>
  >({});
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);
  const sembrado = useRef(false);

  useEffect(() => {
    void ubicacionActual().then((r) => {
      setUbic(r);
      setUbicando(false);
    });
  }, []);

  // Los sí/no arrancan en "No" (siempre contestados): no llevar las botas es una
  // respuesta, no un hueco. Las listas, vacías.
  useEffect(() => {
    if (sembrado.current || campos.length === 0) return;
    sembrado.current = true;
    const inicial: Record<string, RespuestaCruda> = {};
    for (const c of campos) {
      if (c.tipo === "booleano") inicial[c.id] = false;
      if (c.tipo === "seleccion_multiple") inicial[c.id] = [];
    }
    setValores(inicial);
  }, [campos]);

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

  if (camara && sesion) {
    return (
      <CamaraFoto
        usuario={sesion.user.email ?? "Mercaderista"}
        lat={ubic?.ok ? ubic.punto.lat : null}
        lng={ubic?.ok ? ubic.punto.lng : null}
        facing={camara.clase === "selfie" ? "front" : "back"}
        etiqueta={camara.clase === "selfie" ? "Tomar selfie" : "Tomar foto"}
        onListo={(f) => {
          if (camara.clase === "selfie") {
            setFoto(f);
          } else {
            const id = Crypto.randomUUID();
            // En una recaptura, la entrada del uuid reemplazado se elimina.
            const anterior = valores[camara.campoId];
            setFotosPendientes((prev) => {
              const siguiente = { ...prev, [id]: f };
              if (typeof anterior === "string") delete siguiente[anterior];
              return siguiente;
            });
            setValores((prev) => ({ ...prev, [camara.campoId]: id }));
          }
          setCamara(null);
        }}
        onCancelar={() => setCamara(null)}
      />
    );
  }

  async function confirmar() {
    if (!parada || !sesion || !ubic?.ok || !foto) return;
    setGuardando(true);
    setAviso("");
    try {
      const ahora = new Date().toISOString();
      // Cierra el cronómetro de tránsito de la tienda anterior: sus minutos son
      // el traslado HACIA esta visita.
      const trasladoDesde = await leerTransito();
      const tiempoTraslado = trasladoDesde
        ? minutosDeTraslado(trasladoDesde, ahora)
        : null;
      if (trasladoDesde) await limpiarTransito();

      // La VISITA primero y las fotos después. Al revés, la operación de `foto`
      // viajaría antes que la de `visita` en la cola del sync y su FK la
      // rechazaría con un 23503, que el conector descarta como definitivo.
      const visitaId = await crearVisitaCheckIn({
        tenant_id: parada.tenant_id,
        rutero_parada_id: parada.parada_id,
        tienda_id: parada.tienda_id,
        mercaderista_id: sesion.user.id,
        punto: ubic.punto,
        capturado_at: ahora,
        selfie_foto_id: null,
        tiempo_traslado_min: tiempoTraslado,
        // Lo que se le MOSTRÓ es lo que queda anclado, aunque se publique otra
        // versión entre abrir la pantalla y confirmar.
        formulario_version_id: versionId,
      });

      await encolarFoto({
        foto,
        tenantId: parada.tenant_id,
        visitaId,
        levantamientoId: null,
        tipo: "selfie",
      });

      // La foto del checklist es OPCIONAL por diseño: si su encolado falla, se
      // descarta la referencia y el check-in sigue — la ausencia ya descuenta
      // en el puntaje, que es exactamente lo acordado con el cliente.
      const valoresEfectivos = { ...valores };
      let fotosPerdidas = false;
      for (const { campoId, id, foto: pendiente } of fotosPorEncolar(
        campos,
        valores,
        fotosPendientes,
      )) {
        try {
          await encolarFoto({
            id,
            foto: pendiente,
            tipo: "campo_extra",
            tenantId: parada.tenant_id,
            visitaId,
            levantamientoId: null,
          });
        } catch (err) {
          console.error("[check-in] no se pudo encolar la foto del checklist", {
            campo_id: campoId,
            error: mensajeDeError(err),
          });
          delete valoresEfectivos[campoId];
          fotosPerdidas = true;
        }
      }

      try {
        await guardarRespuestasVisita({
          visita_id: visitaId,
          tenant_id: parada.tenant_id,
          respuestas: respuestasDeCheckIn(campos, valoresEfectivos),
        });
      } catch (err) {
        console.error("[check-in] no se pudo guardar el checklist", {
          visita_id: visitaId,
          error: mensajeDeError(err),
        });
        setAviso(
          "El check-in quedó registrado, pero el checklist no se pudo guardar.",
        );
        return; // La tarjeta "✓ Check-in realizado" (reactiva) toma la pantalla.
      }

      if (fotosPerdidas) {
        setAviso(
          "El check-in quedó registrado, pero la foto del checklist no se pudo guardar.",
        );
        return;
      }

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

  const puedeConfirmar = puedeConfirmarCheckIn({
    ubicacionOk: ubic?.ok === true,
    selfieTomada: foto !== null,
    guardando,
  });

  return (
    <ScrollView
      style={e.pantalla}
      contentContainerStyle={e.contenido}
      keyboardShouldPersistTaps="handled"
    >
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
              onPress={() => setCamara({ clase: "selfie" })}
              style={e.botonSec}
              accessibilityRole="button"
            >
              <Text style={e.botonSecTexto}>
                {foto ? "Repetir selfie" : "Abrir cámara"}
              </Text>
            </Pressable>
          </Seccion>

          {campos.length > 0 ? (
            <Seccion titulo="Checklist de herramientas">
              <Text style={e.nota}>
                Marca lo que llevas hoy. No bloquea el check-in.
              </Text>
              {campos.map((campo) => (
                <View key={campo.id} style={e.campo}>
                  <Text style={e.campoEtiqueta}>{campo.etiqueta}</Text>
                  <ControlCampo
                    campo={campo}
                    valor={valores[campo.id]}
                    onCambio={(v) =>
                      setValores((prev) => ({ ...prev, [campo.id]: v }))
                    }
                    onAbrirCamara={() =>
                      setCamara({ clase: "campo", campoId: campo.id })
                    }
                  />
                  {campo.ayuda ? (
                    <Text style={e.nota}>{campo.ayuda}</Text>
                  ) : null}
                </View>
              ))}
            </Seccion>
          ) : null}

          <Pressable
            onPress={() => void confirmar()}
            disabled={!puedeConfirmar}
            style={[e.boton, !puedeConfirmar && e.botonInactivo]}
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

      {/* Región viva siempre montada: si el checklist o su foto fallan tras el
          check-in, el aviso se anuncia aquí (la tarjeta reactiva de arriba ya
          habrá tomado la pantalla). */}
      <Text
        style={[e.notaAlerta, e.avisoVivo]}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
      >
        {aviso}
      </Text>
    </ScrollView>
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
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: espacio.m, paddingBottom: espacio.xl },
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
  avisoVivo: { marginTop: espacio.s, textAlign: "center" },
  campo: { gap: espacio.xs, marginTop: espacio.xs },
  campoEtiqueta: { color: colores.texto, fontSize: 15, fontWeight: "600" },
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
