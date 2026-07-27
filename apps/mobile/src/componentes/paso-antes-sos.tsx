import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { CamaraFoto } from "@/componentes/camara-foto";
import {
  ContingenciaLink,
  pasoEstilos as p,
  Seccion,
  Stepper,
} from "@/componentes/paso-comun";
import { colaFotos } from "@/lib/cola-fotos-instancia";
import { type FotoProcesada } from "@/lib/foto-captura";
import {
  guardarAntesSos,
  useLevantamiento,
  useSkusDeLevantamiento,
} from "@/lib/levantamiento";
import {
  detalleCuadra,
  type FrenteCompetidor,
  shareEnVivo,
  sumaCompetencia,
} from "@/lib/share-of-shelf";
import { ubicacionActual } from "@/lib/ubicacion";
import { colores, espacio } from "@/tema";

// Paso 4.1 + 4.2 del levantamiento: foto "Antes" de la góndola y Share of Shelf
// (agregado + detalle por SKU). "Frentes", nunca "caras". El detalle por SKU se
// recorre de pie: lista con steppers, jamás una pantalla por SKU. Las fotos se
// encolan sin bloquear; el share se calcula fuera de la UI (share-of-shelf.ts).

type CamaraPara = { tipo: "antes" } | { tipo: "sos" } | { tipo: "sku"; skuId: string };

type Props = {
  visitaId: string;
  marcaId: string;
  levantamientoId: string;
  tenantId: string;
  usuario: string;
  onContingencia: () => void;
};

async function encolar(foto: FotoProcesada): Promise<void> {
  await colaFotos.encolar({
    id: Crypto.randomUUID(),
    ruta: foto.ruta,
    hash: foto.hash,
    encolada_at: new Date().toISOString(),
  });
}

export function PasoAntesSos({
  visitaId,
  marcaId,
  levantamientoId,
  tenantId,
  usuario,
  onContingencia,
}: Props) {
  const lev = useLevantamiento(levantamientoId);
  const { skus, cargando } = useSkusDeLevantamiento(
    visitaId,
    marcaId,
    levantamientoId,
  );

  const [camaraPara, setCamaraPara] = useState<CamaraPara | null>(null);
  const [geo, setGeo] = useState({ lat: 0, lng: 0 });
  const [fotoAntes, setFotoAntes] = useState<FotoProcesada | null>(null);
  const [fotoSos, setFotoSos] = useState<FotoProcesada | null>(null);
  const [fotosSku, setFotosSku] = useState<Record<string, FotoProcesada>>({});
  const [propios, setPropios] = useState(0);
  const [competidores, setCompetidores] = useState<FrenteCompetidor[]>([]);
  const [frentesPorSku, setFrentesPorSku] = useState<Record<string, number>>({});
  const [guardando, setGuardando] = useState(false);

  const sembradoAgg = useRef(false);
  const sembradoSku = useRef(false);

  // Hidrata con lo ya capturado (si se vuelve a entrar tras un cierre).
  useEffect(() => {
    if (sembradoAgg.current || !lev) return;
    sembradoAgg.current = true;
    setPropios(lev.sos_frentes_propios ?? 0);
    setCompetidores(parseCompetidores(lev.sos_frentes_competencia));
  }, [lev]);

  useEffect(() => {
    if (sembradoSku.current || cargando) return;
    sembradoSku.current = true;
    const inicial: Record<string, number> = {};
    for (const s of skus) inicial[s.sku_id] = s.frentes_propios ?? 0;
    setFrentesPorSku(inicial);
  }, [cargando, skus]);

  const competencia = useMemo(() => sumaCompetencia(competidores), [competidores]);
  const share = shareEnVivo(propios, competencia);
  const sumaDetalle = useMemo(
    () => Object.values(frentesPorSku).reduce((a, n) => a + n, 0),
    [frentesPorSku],
  );
  const cuadra = detalleCuadra(propios, sumaDetalle);

  async function abrirCamara(para: CamaraPara) {
    const ubic = await ubicacionActual();
    if (ubic.ok) setGeo({ lat: ubic.punto.lat, lng: ubic.punto.lng });
    setCamaraPara(para);
  }

  function recibirFoto(foto: FotoProcesada) {
    if (!camaraPara) return;
    if (camaraPara.tipo === "antes") setFotoAntes(foto);
    else if (camaraPara.tipo === "sos") setFotoSos(foto);
    else setFotosSku((prev) => ({ ...prev, [camaraPara.skuId]: foto }));
    setCamaraPara(null);
  }

  async function continuar() {
    if (!fotoAntes || guardando) return;
    setGuardando(true);
    try {
      await encolar(fotoAntes);
      if (fotoSos) await encolar(fotoSos);
      for (const f of Object.values(fotosSku)) await encolar(f);
      await guardarAntesSos({
        levantamiento_id: levantamientoId,
        tenant_id: tenantId,
        frentes_propios: propios,
        frentes_competencia: competidores.filter((c) => c.competidor.trim()),
        skus: skus.map((s) => ({
          sku_id: s.sku_id,
          ls_id: s.ls_id,
          frentes_propios: frentesPorSku[s.sku_id] ?? 0,
        })),
      });
      // El levantamiento reactivo pasa a "antes hecho" y el wizard avanza solo.
    } finally {
      setGuardando(false);
    }
  }

  if (camaraPara) {
    return (
      <CamaraFoto
        usuario={usuario}
        lat={geo.lat}
        lng={geo.lng}
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
      <Seccion titulo="Foto Antes">
        <View style={p.fila}>
          <View
            style={[
              e.punto,
              { backgroundColor: fotoAntes ? colores.completado : colores.textoSuave },
            ]}
          />
          <Text style={p.filaTexto}>
            {fotoAntes ? "Foto tomada" : "Toma la foto de la góndola (obligatoria)"}
          </Text>
        </View>
        <Pressable
          onPress={() => void abrirCamara({ tipo: "antes" })}
          style={p.botonSec}
          accessibilityRole="button"
        >
          <Text style={p.botonSecTexto}>
            {fotoAntes ? "Repetir foto" : "Abrir cámara"}
          </Text>
        </Pressable>
      </Seccion>

      <Seccion titulo="Share of Shelf — góndola">
        <View style={p.filaEntre}>
          <Text style={p.filaTexto}>Frentes propios</Text>
          <Stepper valor={propios} onCambio={setPropios} etiqueta="Frentes propios" />
        </View>

        {competidores.map((c, i) => (
          <View key={i} style={e.competidor}>
            <TextInput
              value={c.competidor}
              onChangeText={(txt) =>
                setCompetidores((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, competidor: txt } : x)),
                )
              }
              placeholder="Competidor"
              placeholderTextColor={colores.textoSuave}
              style={[p.input, { flex: 1 }]}
              accessibilityLabel={`Nombre del competidor ${i + 1}`}
            />
            <Stepper
              valor={c.frentes}
              onCambio={(n) =>
                setCompetidores((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, frentes: n } : x)),
                )
              }
              etiqueta={`Frentes de ${c.competidor || "competidor"}`}
            />
            <Pressable
              onPress={() =>
                setCompetidores((prev) => prev.filter((_, j) => j !== i))
              }
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Quitar competidor ${i + 1}`}
            >
              <Text style={e.quitar}>✕</Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          onPress={() =>
            setCompetidores((prev) => [...prev, { competidor: "", frentes: 0 }])
          }
          style={p.botonSec}
          accessibilityRole="button"
        >
          <Text style={p.botonSecTexto}>Añadir competidor</Text>
        </Pressable>

        <View style={e.share}>
          <Text style={e.shareLabel}>Share propio</Text>
          <Text style={e.sharePct}>{share}%</Text>
        </View>

        <Pressable
          onPress={() => void abrirCamara({ tipo: "sos" })}
          style={p.botonSec}
          accessibilityRole="button"
        >
          <Text style={p.botonSecTexto}>
            {fotoSos ? "Repetir foto (opcional)" : "Foto de la góndola (opcional)"}
          </Text>
        </Pressable>
      </Seccion>

      <Seccion titulo="Detalle por SKU">
        {cargando ? (
          <ActivityIndicator color={colores.marca} />
        ) : skus.length === 0 ? (
          <Text style={p.nota}>Sin SKU codificados para esta marca.</Text>
        ) : (
          skus.map((s) => (
            <View key={s.sku_id} style={e.skuFila}>
              <View style={{ flex: 1 }}>
                <Text style={e.skuNombre} numberOfLines={1}>
                  {s.nombre}
                </Text>
                <Text style={e.skuCodigo}>{s.codigo}</Text>
              </View>
              <Pressable
                onPress={() => void abrirCamara({ tipo: "sku", skuId: s.sku_id })}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Foto de ${s.nombre}`}
              >
                <Text
                  style={[
                    e.camaraSku,
                    fotosSku[s.sku_id] != null && { color: colores.completado },
                  ]}
                >
                  {fotosSku[s.sku_id] != null ? "✓ 📷" : "📷"}
                </Text>
              </Pressable>
              <Stepper
                valor={frentesPorSku[s.sku_id] ?? 0}
                onCambio={(n) =>
                  setFrentesPorSku((prev) => ({ ...prev, [s.sku_id]: n }))
                }
                etiqueta={`Frentes de ${s.nombre}`}
              />
            </View>
          ))
        )}

        {!cuadra ? (
          <Text style={e.aviso}>
            El detalle por SKU ({sumaDetalle}) no cuadra con el agregado (
            {propios}). Puedes continuar igual.
          </Text>
        ) : null}
      </Seccion>

      <Pressable
        onPress={() => void continuar()}
        disabled={!fotoAntes || guardando}
        style={[p.boton, (!fotoAntes || guardando) && p.botonInactivo]}
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

function parseCompetidores(raw: string | null): FrenteCompetidor[] {
  if (!raw) return [];
  try {
    const datos: unknown = JSON.parse(raw);
    return Array.isArray(datos) ? (datos as FrenteCompetidor[]) : [];
  } catch {
    return [];
  }
}

const e = StyleSheet.create({
  punto: { width: 10, height: 10, borderRadius: 5 },
  competidor: { flexDirection: "row", alignItems: "center", gap: espacio.s },
  quitar: { color: colores.textoSuave, fontSize: 18, paddingHorizontal: 4 },
  share: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: espacio.xs,
  },
  shareLabel: { color: colores.textoSuave, fontSize: 14, fontWeight: "600" },
  sharePct: { color: colores.texto, fontSize: 22, fontWeight: "800" },
  skuFila: {
    flexDirection: "row",
    alignItems: "center",
    gap: espacio.s,
    paddingVertical: espacio.xs,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
  },
  skuNombre: { color: colores.texto, fontSize: 15, fontWeight: "600" },
  skuCodigo: { color: colores.textoSuave, fontSize: 12, marginTop: 1 },
  camaraSku: { fontSize: 18, paddingHorizontal: espacio.xs },
  aviso: {
    color: colores.textoSuave,
    fontSize: 13,
    lineHeight: 18,
    marginTop: espacio.s,
  },
});
