import type { PuntoGeo } from "@market-track/shared";
import { tipoExhibicionSchema } from "@market-track/shared";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CamaraFoto } from "@/componentes/camara-foto";
import {
  ContingenciaLink,
  pasoEstilos as p,
  Seccion,
  SiNo,
  Stepper,
} from "@/componentes/paso-comun";
import { encolarFoto } from "@/lib/cola-fotos-instancia";
import { type FotoCapturada } from "@/lib/foto-captura";
import { guardarExhibiciones, useExhibiciones } from "@/lib/levantamiento";
import { ubicacionActual } from "@/lib/ubicacion";
import { colores, espacio, radio } from "@/tema";

// Paso 4.5 "Exhibiciones": auditar las NEGOCIADAS (pre-carga: instalada,
// unidades, foto) y registrar las ADICIONALES/conseguidas por el mercaderista
// (tipo, unidades, foto, vigencia). La foto "Después" es un paso aparte. Las
// fotos se encolan; su FK queda null hasta MAR-39.

const TIPOS = tipoExhibicionSchema.options;

type EstadoNeg = { ex_id: string | null; instalada: boolean; unidades: number };
type Adicional = {
  ex_id: string | null;
  tipo: string;
  unidades: number;
  vigente: boolean;
};
type CamaraPara = { tipo: "neg"; id: string } | { tipo: "add"; idx: number };

type Props = {
  visitaId: string;
  marcaId: string;
  levantamientoId: string;
  tenantId: string;
  usuario: string;
  onCompletar: () => void;
  onContingencia: () => void;
};

export function PasoExhibiciones({
  visitaId,
  marcaId,
  levantamientoId,
  tenantId,
  usuario,
  onCompletar,
  onContingencia,
}: Props) {
  const {
    negociadas,
    adicionales: adicPrevias,
    cargando,
  } = useExhibiciones(visitaId, marcaId, levantamientoId);

  const [estadoNeg, setEstadoNeg] = useState<Record<string, EstadoNeg>>({});
  const [adicionales, setAdicionales] = useState<Adicional[]>([]);
  const [camaraPara, setCamaraPara] = useState<CamaraPara | null>(null);
  const [geo, setGeo] = useState<PuntoGeo | null>(null);
  const [fotosNeg, setFotosNeg] = useState<Record<string, FotoCapturada>>({});
  const [fotosAdd, setFotosAdd] = useState<Record<number, FotoCapturada>>({});
  const [guardando, setGuardando] = useState(false);
  const sembrado = useRef(false);

  useEffect(() => {
    if (sembrado.current || cargando) return;
    sembrado.current = true;
    const neg: Record<string, EstadoNeg> = {};
    for (const n of negociadas) {
      neg[n.negociada_id] = {
        ex_id: n.ex_id,
        instalada: n.instalada === 1,
        unidades: n.unidades ?? 0,
      };
    }
    setEstadoNeg(neg);
    setAdicionales(
      adicPrevias.map((a) => ({
        ex_id: a.ex_id,
        tipo: a.tipo,
        unidades: a.unidades ?? 0,
        vigente: a.vigente === 1,
      })),
    );
  }, [cargando, negociadas, adicPrevias]);

  function setNeg(id: string, cambios: Partial<EstadoNeg>) {
    setEstadoNeg((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { ex_id: null, instalada: false, unidades: 0 }),
        ...cambios,
      },
    }));
  }

  function setAdic(idx: number, cambios: Partial<Adicional>) {
    setAdicionales((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, ...cambios } : a)),
    );
  }

  async function abrirCamara(para: CamaraPara) {
    const ubic = await ubicacionActual();
    // Null si el GPS no dio lectura: `0,0` es un punto real en el golfo de
    // Guinea y acabaría guardado como la coordenada de la evidencia.
    setGeo(ubic.ok ? ubic.punto : null);
    setCamaraPara(para);
  }

  function recibirFoto(foto: FotoCapturada) {
    if (!camaraPara) return;
    if (camaraPara.tipo === "neg") {
      setFotosNeg((prev) => ({ ...prev, [camaraPara.id]: foto }));
    } else {
      setFotosAdd((prev) => ({ ...prev, [camaraPara.idx]: foto }));
    }
    setCamaraPara(null);
  }

  async function continuar() {
    if (guardando) return;
    setGuardando(true);
    try {
      const comun = {
        tenantId,
        visitaId,
        levantamientoId,
        tipo: "exhibicion" as const,
      };
      for (const f of Object.values(fotosNeg)) {
        await encolarFoto({ ...comun, foto: f });
      }
      for (const f of Object.values(fotosAdd)) {
        await encolarFoto({ ...comun, foto: f });
      }
      await guardarExhibiciones({
        levantamiento_id: levantamientoId,
        tenant_id: tenantId,
        negociadas: negociadas.map((n) => {
          const s = estadoNeg[n.negociada_id];
          return {
            negociada_id: n.negociada_id,
            ex_id: s?.ex_id ?? n.ex_id,
            instalada: s?.instalada ?? false,
            unidades: s?.unidades ?? 0,
          };
        }),
        adicionales: adicionales.filter((a) => a.tipo),
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
      <Seccion titulo="Exhibiciones negociadas">
        {cargando ? (
          <ActivityIndicator color={colores.marca} />
        ) : negociadas.length === 0 ? (
          <Text style={p.nota}>
            Sin exhibiciones negociadas para esta marca.
          </Text>
        ) : (
          negociadas.map((n) => {
            const s = estadoNeg[n.negociada_id] ?? {
              ex_id: null,
              instalada: false,
              unidades: 0,
            };
            return (
              <View key={n.negociada_id} style={e.item}>
                <View style={p.filaEntre}>
                  <Text style={e.tipo}>{n.tipo}</Text>
                  <CamaraBtn
                    tomada={fotosNeg[n.negociada_id] != null}
                    onPress={() =>
                      void abrirCamara({ tipo: "neg", id: n.negociada_id })
                    }
                    etiqueta={`Foto de ${n.tipo}`}
                  />
                </View>
                <View style={p.filaEntre}>
                  <Text style={p.filaTexto}>¿Instalada?</Text>
                  <SiNo
                    valor={s.instalada}
                    onCambio={(v) => setNeg(n.negociada_id, { instalada: v })}
                    etiqueta={`${n.tipo} instalada`}
                  />
                </View>
                <View style={p.filaEntre}>
                  <Text style={p.filaTexto}>Unidades</Text>
                  <Stepper
                    valor={s.unidades}
                    onCambio={(u) => setNeg(n.negociada_id, { unidades: u })}
                    etiqueta={`Unidades de ${n.tipo}`}
                  />
                </View>
              </View>
            );
          })
        )}
      </Seccion>

      <Seccion titulo="Exhibiciones conseguidas">
        {adicionales.map((a, idx) => (
          <View key={idx} style={e.item}>
            <View style={p.filaEntre}>
              <Text style={e.tipo}>Nueva exhibición</Text>
              <View style={e.acciones}>
                <CamaraBtn
                  tomada={fotosAdd[idx] != null}
                  onPress={() => void abrirCamara({ tipo: "add", idx })}
                  etiqueta="Foto de la exhibición conseguida"
                />
                <Pressable
                  onPress={() =>
                    setAdicionales((prev) => prev.filter((_, i) => i !== idx))
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Quitar exhibición conseguida"
                >
                  <Text style={e.quitar}>✕</Text>
                </Pressable>
              </View>
            </View>
            <View style={e.tipos}>
              {TIPOS.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setAdic(idx, { tipo: t })}
                  style={[e.chip, a.tipo === t && e.chipActivo]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: a.tipo === t }}
                >
                  <Text
                    style={[e.chipTexto, a.tipo === t && e.chipTextoActivo]}
                  >
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={p.filaEntre}>
              <Text style={p.filaTexto}>Unidades</Text>
              <Stepper
                valor={a.unidades}
                onCambio={(u) => setAdic(idx, { unidades: u })}
                etiqueta="Unidades de la exhibición conseguida"
              />
            </View>
            <View style={p.filaEntre}>
              <Text style={p.filaTexto}>¿Vigente?</Text>
              <SiNo
                valor={a.vigente}
                onCambio={(v) => setAdic(idx, { vigente: v })}
                etiqueta="Exhibición conseguida vigente"
              />
            </View>
          </View>
        ))}

        <Pressable
          onPress={() =>
            setAdicionales((prev) => [
              ...prev,
              { ex_id: null, tipo: "adicional", unidades: 0, vigente: true },
            ])
          }
          style={p.botonSec}
          accessibilityRole="button"
        >
          <Text style={p.botonSecTexto}>Añadir exhibición conseguida</Text>
        </Pressable>
      </Seccion>

      <Pressable
        onPress={() => void continuar()}
        disabled={guardando}
        style={[p.boton, guardando && p.botonInactivo]}
        accessibilityRole="button"
      >
        {guardando ? (
          <ActivityIndicator color={colores.marcaTexto} />
        ) : (
          <Text style={p.botonTexto}>Continuar</Text>
        )}
      </Pressable>

      <ContingenciaLink onPress={onContingencia} />
    </ScrollView>
  );
}

function CamaraBtn({
  tomada,
  onPress,
  etiqueta,
}: {
  tomada: boolean;
  onPress: () => void;
  etiqueta: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
    >
      <Text style={[e.camara, tomada && { color: colores.completado }]}>
        {tomada ? "✓ 📷" : "📷"}
      </Text>
    </Pressable>
  );
}

const e = StyleSheet.create({
  item: {
    gap: espacio.s,
    paddingTop: espacio.s,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
  },
  tipo: {
    color: colores.texto,
    fontSize: 15,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  acciones: { flexDirection: "row", alignItems: "center", gap: espacio.m },
  quitar: { color: colores.textoSuave, fontSize: 18, paddingHorizontal: 4 },
  camara: { fontSize: 18 },
  tipos: { flexDirection: "row", flexWrap: "wrap", gap: espacio.xs },
  chip: {
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radio.s,
    paddingHorizontal: espacio.s,
    paddingVertical: 4,
    backgroundColor: colores.fondo,
  },
  chipActivo: { backgroundColor: colores.marca, borderColor: colores.marca },
  chipTexto: {
    color: colores.textoSuave,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  chipTextoActivo: { color: colores.marcaTexto },
});
