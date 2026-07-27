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
import { colores, espacio, radio } from "@/tema";

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
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: espacio.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <Seccion titulo="Foto Antes">
        <Fila>
          <Punto color={fotoAntes ? colores.completado : colores.textoSuave} />
          <Text style={e.filaTexto}>
            {fotoAntes ? "Foto tomada" : "Toma la foto de la góndola (obligatoria)"}
          </Text>
        </Fila>
        <Pressable
          onPress={() => void abrirCamara({ tipo: "antes" })}
          style={e.botonSec}
          accessibilityRole="button"
        >
          <Text style={e.botonSecTexto}>
            {fotoAntes ? "Repetir foto" : "Abrir cámara"}
          </Text>
        </Pressable>
      </Seccion>

      <Seccion titulo="Share of Shelf — góndola">
        <View style={e.filaStepper}>
          <Text style={e.filaTexto}>Frentes propios</Text>
          <Stepper
            valor={propios}
            onCambio={setPropios}
            etiqueta="Frentes propios"
          />
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
              style={e.competidorInput}
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
          style={e.botonSec}
          accessibilityRole="button"
        >
          <Text style={e.botonSecTexto}>Añadir competidor</Text>
        </Pressable>

        <View style={e.share}>
          <Text style={e.shareLabel}>Share propio</Text>
          <Text style={e.sharePct}>{share}%</Text>
        </View>

        <Pressable
          onPress={() => void abrirCamara({ tipo: "sos" })}
          style={e.botonSec}
          accessibilityRole="button"
        >
          <Text style={e.botonSecTexto}>
            {fotoSos ? "Repetir foto (opcional)" : "Foto de la góndola (opcional)"}
          </Text>
        </Pressable>
      </Seccion>

      <Seccion titulo="Detalle por SKU">
        {cargando ? (
          <ActivityIndicator color={colores.marca} />
        ) : skus.length === 0 ? (
          <Text style={e.nota}>Sin SKU codificados para esta marca.</Text>
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
        style={[e.boton, (!fotoAntes || guardando) && e.botonInactivo]}
        accessibilityRole="button"
      >
        {guardando ? (
          <ActivityIndicator color={colores.marcaTexto} />
        ) : (
          <Text style={e.botonTexto}>Continuar</Text>
        )}
      </Pressable>

      <Pressable
        onPress={onContingencia}
        style={e.contingencia}
        accessibilityRole="button"
      >
        <Text style={e.contingenciaTexto}>No puedo completar este paso</Text>
      </Pressable>
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

function Stepper({
  valor,
  onCambio,
  etiqueta,
}: {
  valor: number;
  onCambio: (n: number) => void;
  etiqueta: string;
}) {
  return (
    <View style={e.stepper}>
      <Pressable
        onPress={() => onCambio(Math.max(0, valor - 1))}
        style={e.stepperBoton}
        accessibilityRole="button"
        accessibilityLabel={`Restar a ${etiqueta}`}
      >
        <Text style={e.stepperSigno}>−</Text>
      </Pressable>
      <Text style={e.stepperValor}>{valor}</Text>
      <Pressable
        onPress={() => onCambio(valor + 1)}
        style={e.stepperBoton}
        accessibilityRole="button"
        accessibilityLabel={`Sumar a ${etiqueta}`}
      >
        <Text style={e.stepperSigno}>+</Text>
      </Pressable>
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
  filaStepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: espacio.s,
  },
  punto: { width: 10, height: 10, borderRadius: 5 },
  nota: { color: colores.textoSuave, fontSize: 14, lineHeight: 20 },
  competidor: { flexDirection: "row", alignItems: "center", gap: espacio.s },
  competidorInput: {
    flex: 1,
    backgroundColor: colores.fondo,
    borderRadius: radio.s,
    borderWidth: 1,
    borderColor: colores.borde,
    color: colores.texto,
    fontSize: 14,
    paddingHorizontal: espacio.s,
    height: 40,
  },
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
  stepper: { flexDirection: "row", alignItems: "center", gap: espacio.s },
  stepperBoton: {
    width: 36,
    height: 36,
    borderRadius: radio.s,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.fondo,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperSigno: { color: colores.texto, fontSize: 20, fontWeight: "700" },
  stepperValor: {
    color: colores.texto,
    fontSize: 17,
    fontWeight: "700",
    minWidth: 28,
    textAlign: "center",
  },
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
  contingencia: { alignItems: "center", paddingVertical: espacio.m },
  contingenciaTexto: {
    color: colores.textoSuave,
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
