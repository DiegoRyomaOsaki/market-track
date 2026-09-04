import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  ContingenciaLink,
  pasoEstilos as p,
  Seccion,
  Stepper,
} from "@/componentes/paso-comun";
import { guardarQuiebres, useSkusDeLevantamiento } from "@/lib/levantamiento";
import { deltaDiferencia, esDiferencia, esQuiebre } from "@/lib/quiebres";
import { colores, espacio, radio } from "@/tema";

// Paso 4.3 "Quiebres y diferencias": stock de sistema vs piso por SKU, con dos
// badges automáticos y excluyentes. Los flags QUIEBRE/DIFERENCIA los DERIVA la
// base al sincronizar (no los escribe la app); el badge es feedback en vivo.

type Stock = { sistema: number; piso: number };

type Props = {
  visitaId: string;
  marcaId: string;
  levantamientoId: string;
  tenantId: string;
  onCompletar: () => void;
  onContingencia: () => void;
};

export function PasoQuiebres({
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
  const [stock, setStock] = useState<Record<string, Stock>>({});
  const [guardando, setGuardando] = useState(false);
  const sembrado = useRef(false);

  useEffect(() => {
    if (sembrado.current || cargando) return;
    sembrado.current = true;
    const inicial: Record<string, Stock> = {};
    for (const s of skus) {
      inicial[s.sku_id] = {
        sistema: s.stock_sistema ?? 0,
        piso: s.stock_piso ?? 0,
      };
    }
    setStock(inicial);
  }, [cargando, skus]);

  function set(skuId: string, campo: keyof Stock, valor: number) {
    setStock((prev) => ({
      ...prev,
      [skuId]: { ...(prev[skuId] ?? { sistema: 0, piso: 0 }), [campo]: valor },
    }));
  }

  async function continuar() {
    if (guardando) return;
    setGuardando(true);
    try {
      await guardarQuiebres({
        levantamiento_id: levantamientoId,
        tenant_id: tenantId,
        skus: skus.map((s) => ({
          sku_id: s.sku_id,
          ls_id: s.ls_id,
          stock_sistema: stock[s.sku_id]?.sistema ?? 0,
          stock_piso: stock[s.sku_id]?.piso ?? 0,
        })),
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
        <ActivityIndicator
          color={colores.marca}
          style={{ marginTop: espacio.l }}
        />
      ) : skus.length === 0 ? (
        <Text style={[p.nota, { marginTop: espacio.l }]}>
          Sin SKU codificados para esta marca.
        </Text>
      ) : (
        skus.map((s) => {
          const st = stock[s.sku_id] ?? { sistema: 0, piso: 0 };
          const quiebre = esQuiebre(st.sistema, st.piso);
          const diferencia = esDiferencia(st.sistema, st.piso);
          return (
            <Seccion key={s.sku_id} titulo={s.codigo}>
              <View style={p.filaEntre}>
                <Text style={p.filaTexto} numberOfLines={1}>
                  {s.nombre}
                </Text>
                <Badge
                  quiebre={quiebre}
                  diferencia={diferencia}
                  delta={deltaDiferencia(st.sistema, st.piso)}
                />
              </View>
              <View style={p.filaEntre}>
                <Text style={p.filaTexto}>Sistema</Text>
                <Stepper
                  valor={st.sistema}
                  onCambio={(n) => set(s.sku_id, "sistema", n)}
                  etiqueta={`Stock en sistema de ${s.nombre}`}
                />
              </View>
              <View style={p.filaEntre}>
                <Text style={p.filaTexto}>Piso</Text>
                <Stepper
                  valor={st.piso}
                  onCambio={(n) => set(s.sku_id, "piso", n)}
                  etiqueta={`Stock en piso de ${s.nombre}`}
                />
              </View>
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

function Badge({
  quiebre,
  diferencia,
  delta,
}: {
  quiebre: boolean;
  diferencia: boolean;
  delta: number;
}) {
  if (quiebre) {
    return (
      <View style={[e.badge, { backgroundColor: colores.alerta }]}>
        <Text style={e.badgeTexto}>QUIEBRE</Text>
      </View>
    );
  }
  if (diferencia) {
    return (
      <View style={[e.badge, { backgroundColor: colores.ambar }]}>
        <Text style={e.badgeTexto}>
          DIFERENCIA {delta > 0 ? `+${delta}` : delta}
        </Text>
      </View>
    );
  }
  return null;
}

const e = StyleSheet.create({
  badge: {
    borderRadius: radio.s,
    paddingHorizontal: espacio.s,
    paddingVertical: 3,
  },
  badgeTexto: { color: "#fff", fontSize: 11, fontWeight: "800" },
});
