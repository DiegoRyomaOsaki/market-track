import type { CampoFormulario, PuntoGeo } from "@market-track/shared";
import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";

import { CamaraFoto } from "@/componentes/camara-foto";
import { ControlCampo } from "@/componentes/campo-configurable";
import {
  ContingenciaLink,
  pasoEstilos as p,
  Seccion,
} from "@/componentes/paso-comun";
import { encolarFoto } from "@/lib/cola-fotos-instancia";
import { mensajeDeError } from "@/lib/error";
import type { FotoCapturada } from "@/lib/foto-captura";
import {
  coercionValorRespuesta,
  crudoDesdeValor,
  estaContestado,
  faltanObligatorios,
  fotosPorEncolar,
  type RespuestaCruda,
} from "@/lib/formulario";
import { guardarRespuestas, useRespuestas } from "@/lib/levantamiento";
import type { PasoWizardConfigurable } from "@/lib/pasos-levantamiento";
import { ubicacionActual } from "@/lib/ubicacion";
import { colores, espacio } from "@/tema";

// Un paso CONFIGURABLE del wizard (MAR-80): renderiza los campos libres de la
// definición por tipo, reusando los primitivos de paso-comun. Guarda las
// respuestas en `levantamiento_respuesta` al continuar. Un campo `foto` captura
// SOLO desde la cámara (watermark y geo sellados al capturar); su respuesta es
// el uuid de la fila `foto`, que se encola a la cola de disco al continuar.

type Props = {
  paso: PasoWizardConfigurable;
  visitaId: string;
  levantamientoId: string;
  tenantId: string;
  usuario: string;
  onCompletar: () => void;
  onContingencia: () => void;
};

export function PasoConfigurable({
  paso,
  visitaId,
  levantamientoId,
  tenantId,
  usuario,
  onCompletar,
  onContingencia,
}: Props) {
  const { respuestas: filas, cargando } = useRespuestas(levantamientoId);
  const [valores, setValores] = useState<Record<string, RespuestaCruda>>({});
  const [guardando, setGuardando] = useState(false);
  // Capturas aún no encoladas, por el uuid PRE-generado que ya vive en `valores`
  // (así `estaContestado`/`faltanObligatorios` funcionan sin cambios). Al
  // continuar se encolan; una entrada cuyo uuid ya no está en `valores` fue
  // reemplazada por una recaptura y se descarta.
  const [fotosPendientes, setFotosPendientes] = useState<
    Record<string, FotoCapturada>
  >({});
  const [camaraPara, setCamaraPara] = useState<string | null>(null);
  const [geo, setGeo] = useState<PuntoGeo | null>(null);
  const [errorFotos, setErrorFotos] = useState("");
  const sembrado = useRef(false);

  const rowIds = useMemo(
    () => Object.fromEntries(filas.map((f) => [f.campo_id, f.id])),
    [filas],
  );

  useEffect(() => {
    if (sembrado.current || cargando) return;
    sembrado.current = true;
    const inicial: Record<string, RespuestaCruda> = {};
    // Los sí/no arrancan en "No" (siempre contestados); las listas, vacías.
    for (const c of paso.campos) {
      if (c.tipo === "booleano") inicial[c.id] = false;
      if (c.tipo === "seleccion_multiple") inicial[c.id] = [];
    }
    for (const f of filas) inicial[f.campo_id] = crudoDesdeValor(f.valor);
    setValores(inicial);
  }, [cargando, filas, paso.campos]);

  function set(id: string, v: RespuestaCruda) {
    setValores((prev) => ({ ...prev, [id]: v }));
  }

  const faltan = faltanObligatorios(paso.campos, valores);

  async function abrirCamara(campoId: string) {
    const ubic = await ubicacionActual();
    // Null si el GPS no dio lectura: `0,0` es un punto real en el golfo de
    // Guinea y acabaría guardado como la coordenada de la evidencia.
    setGeo(ubic.ok ? ubic.punto : null);
    setCamaraPara(campoId);
  }

  function recibirFoto(foto: FotoCapturada) {
    if (!camaraPara) return;
    const id = Crypto.randomUUID();
    // En una recaptura, la entrada del uuid reemplazado se elimina: si se
    // quedara, crecería con cada repetición durante toda la visita.
    const anterior = valores[camaraPara];
    setFotosPendientes((prev) => {
      const siguiente = { ...prev, [id]: foto };
      if (typeof anterior === "string") delete siguiente[anterior];
      return siguiente;
    });
    set(camaraPara, id);
    setCamaraPara(null);
  }

  async function continuar() {
    if (guardando || faltan) return;
    setGuardando(true);
    setErrorFotos("");
    try {
      // Las fotos se encolan ANTES de guardar las respuestas: los CRUD del sync
      // se reproducen en orden de inserción, así la fila `foto` llega al servidor
      // antes que la respuesta que la referencia.
      try {
        for (const { id, foto } of fotosPorEncolar(
          paso.campos,
          valores,
          fotosPendientes,
        )) {
          await encolarFoto({
            id,
            foto,
            tipo: "campo_extra",
            tenantId,
            visitaId,
            levantamientoId,
          });
          setFotosPendientes((prev) => {
            const { [id]: _, ...resto } = prev;
            return resto;
          });
        }
      } catch (err) {
        // Sin la foto encolada no se guarda NADA: una respuesta que apunta a una
        // foto que nunca entró a la cola sería una referencia a la nada. El
        // mercaderista conserva lo tecleado y puede reintentar o ir a contingencia.
        console.error("[paso-configurable] no se pudo encolar la foto", {
          error: mensajeDeError(err),
        });
        setErrorFotos(
          "No se pudo preparar la foto. Inténtalo de nuevo o registra una contingencia.",
        );
        return;
      }
      const respuestas = paso.campos
        .filter((c) => estaContestado(valores[c.id]))
        .map((c) => ({
          id: rowIds[c.id] ?? null,
          campo_id: c.id,
          valor: coercionValorRespuesta(c, valores[c.id]),
        }));
      await guardarRespuestas({
        levantamiento_id: levantamientoId,
        tenant_id: tenantId,
        respuestas,
      });
      onCompletar();
    } finally {
      setGuardando(false);
    }
  }

  if (camaraPara) {
    return (
      <CamaraFoto
        usuario={usuario}
        lat={geo?.lat ?? null}
        lng={geo?.lng ?? null}
        facing="back"
        etiqueta="Tomar foto"
        onListo={recibirFoto}
        onCancelar={() => setCamaraPara(null)}
      />
    );
  }

  return (
    <ScrollView
      style={p.scroll}
      contentContainerStyle={p.scrollContenido}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={e.titulo}>{paso.titulo || "Datos adicionales"}</Text>

      {cargando ? (
        <ActivityIndicator
          color={colores.marca}
          style={{ marginTop: espacio.l }}
        />
      ) : paso.campos.length === 0 ? (
        <Text style={[p.nota, { marginTop: espacio.l }]}>
          Este paso no tiene campos.
        </Text>
      ) : (
        paso.campos.map((campo) => (
          <Seccion key={campo.id} titulo={etiquetaCampo(campo)}>
            <ControlCampo
              campo={campo}
              valor={valores[campo.id]}
              onCambio={(v) => set(campo.id, v)}
              onAbrirCamara={() => void abrirCamara(campo.id)}
            />
            {campo.ayuda ? <Text style={p.nota}>{campo.ayuda}</Text> : null}
          </Seccion>
        ))
      )}

      <Pressable
        onPress={() => void continuar()}
        disabled={guardando || faltan}
        style={[p.boton, (guardando || faltan) && p.botonInactivo]}
        accessibilityRole="button"
      >
        {guardando ? (
          <ActivityIndicator color={colores.marcaTexto} />
        ) : (
          <Text style={p.botonTexto}>Continuar</Text>
        )}
      </Pressable>
      {/* Región viva siempre montada: al cambiar el texto, el lector de
          pantalla anuncia el aviso (si se montara condicionalmente, no lo vería). */}
      <Text
        style={[p.nota, e.aviso]}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
      >
        {errorFotos ||
          (faltan
            ? "Completa los campos obligatorios (*) para continuar, o registra una contingencia."
            : "")}
      </Text>

      <ContingenciaLink onPress={onContingencia} />
    </ScrollView>
  );
}

function etiquetaCampo(campo: CampoFormulario): string {
  const base = campo.etiqueta || "Campo";
  return campo.obligatorio ? `${base} *` : base;
}

const e = StyleSheet.create({
  titulo: {
    color: colores.texto,
    fontSize: 17,
    fontWeight: "700",
    marginTop: espacio.s,
  },
  aviso: { marginTop: espacio.s, textAlign: "center" },
});
