import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  ContingenciaLink,
  pasoEstilos as p,
  Seccion,
  SiNo,
} from "@/componentes/paso-comun";
import { guardarPrecios, useSkusDeLevantamiento } from "@/lib/levantamiento";
import { colores, espacio } from "@/tema";

// Paso 4.4 "Precios": el precio del cliente por SKU y el árbol de promo. La
// pregunta de "comunicada" solo aparece si hay promo (bifurca regular → promo →
// comunicada). La alerta de desviación la calcula el servidor, no la app.

type PrecioSku = { precio: string; hayPromo: boolean; comunicada: boolean };

type Props = {
  visitaId: string;
  marcaId: string;
  levantamientoId: string;
  tenantId: string;
  onCompletar: () => void;
  onContingencia: () => void;
};

export function PasoPrecios({
  visitaId,
  marcaId,
  levantamientoId,
  tenantId,
  onCompletar,
  onContingencia,
}: Props) {
  const { skus, cargando } = useSkusDeLevantamiento(
    visitaId,
    marcaId,
    levantamientoId,
  );
  const [datos, setDatos] = useState<Record<string, PrecioSku>>({});
  const [guardando, setGuardando] = useState(false);
  const sembrado = useRef(false);

  useEffect(() => {
    if (sembrado.current || cargando) return;
    sembrado.current = true;
    const inicial: Record<string, PrecioSku> = {};
    for (const s of skus) {
      inicial[s.sku_id] = {
        precio: s.precio_registrado != null ? String(s.precio_registrado) : "",
        hayPromo: s.hay_promo === 1,
        comunicada: s.promo_comunicada === 1,
      };
    }
    setDatos(inicial);
  }, [cargando, skus]);

  function set(skuId: string, cambios: Partial<PrecioSku>) {
    setDatos((prev) => ({
      ...prev,
      [skuId]: {
        ...(prev[skuId] ?? { precio: "", hayPromo: false, comunicada: false }),
        ...cambios,
      },
    }));
  }

  async function continuar() {
    if (guardando) return;
    setGuardando(true);
    try {
      await guardarPrecios({
        levantamiento_id: levantamientoId,
        tenant_id: tenantId,
        skus: skus.map((s) => {
          const d = datos[s.sku_id];
          const precio = d?.precio.trim() ? Number(d.precio) : NaN;
          return {
            sku_id: s.sku_id,
            ls_id: s.ls_id,
            precio_registrado: Number.isFinite(precio) ? precio : null,
            hay_promo: d?.hayPromo ?? false,
            promo_comunicada: d?.comunicada ?? false,
          };
        }),
      });
      onCompletar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ScrollView
      style={p.scroll}
      contentContainerStyle={p.scrollContenido}
      keyboardShouldPersistTaps="handled"
    >
      {cargando ? (
        <ActivityIndicator color={colores.marca} style={{ marginTop: espacio.l }} />
      ) : skus.length === 0 ? (
        <Text style={[p.nota, { marginTop: espacio.l }]}>
          Sin SKU codificados para esta marca.
        </Text>
      ) : (
        skus.map((s) => {
          const d = datos[s.sku_id] ?? {
            precio: "",
            hayPromo: false,
            comunicada: false,
          };
          return (
            <Seccion key={s.sku_id} titulo={s.codigo}>
              <Text style={e.nombre} numberOfLines={1}>
                {s.nombre}
              </Text>
              <View style={p.filaEntre}>
                <Text style={p.filaTexto}>Precio en tienda (S/)</Text>
                <TextInput
                  value={d.precio}
                  onChangeText={(t) => set(s.sku_id, { precio: t })}
                  placeholder="0.00"
                  placeholderTextColor={colores.textoSuave}
                  keyboardType="decimal-pad"
                  style={[p.input, e.precio]}
                  accessibilityLabel={`Precio de ${s.nombre}`}
                />
              </View>
              <View style={p.filaEntre}>
                <Text style={p.filaTexto}>¿Hay promoción?</Text>
                <SiNo
                  valor={d.hayPromo}
                  onCambio={(v) =>
                    set(s.sku_id, { hayPromo: v, comunicada: v && d.comunicada })
                  }
                  etiqueta={`Promoción de ${s.nombre}`}
                />
              </View>
              {d.hayPromo ? (
                <View style={p.filaEntre}>
                  <Text style={p.filaTexto}>¿Está comunicada?</Text>
                  <SiNo
                    valor={d.comunicada}
                    onCambio={(v) => set(s.sku_id, { comunicada: v })}
                    etiqueta={`Promoción comunicada de ${s.nombre}`}
                  />
                </View>
              ) : null}
            </Seccion>
          );
        })
      )}

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

const e = StyleSheet.create({
  nombre: { color: colores.texto, fontSize: 15, fontWeight: "600" },
  precio: { width: 110, textAlign: "right" },
});
