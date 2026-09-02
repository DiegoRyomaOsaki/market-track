import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";

import { AyudaBoton } from "@/componentes/ayuda-boton";
import { MenuVisita, type ModuloDelMenu } from "@/componentes/menu-visita";
import { ModuloActivo } from "@/componentes/modulo-activo";
import {
  completarLevantamiento,
  crearLevantamiento,
  useContingenciasDeVisita,
  useDefinicionesDeVisita,
  useMarcasDeVisita,
  useVisita,
} from "@/lib/levantamiento";
import { construirPasos } from "@/lib/pasos-levantamiento";
import {
  estadoDeModulos,
  marcaCompleta,
  marcarModuloHecho,
  soloDe,
  useModulosHechosDeVisita,
} from "@/lib/progreso-visita";
import { useSesion } from "@/sesion";
import { colores, espacio } from "@/tema";

// El menú de la visita y la navegación libre entre módulos.
//
// Acordado en la 4ª revisión con el cliente (25 ago 2026): "módulo primero,
// marca después". Sustituye al wizard secuencial por marca, que obligaba a
// terminar una marca entera antes de empezar la siguiente —"tendría que ir a
// trastienda, góndola, exhibiciones, terminar la marca, y otra vez trastienda,
// góndola, exhibiciones"— y que dejaba trabado al mercaderista cuando el
// siguiente paso era una trastienda a la que no lo dejaban entrar.
//
// Una sola ruta, y el módulo abierto es estado de pantalla. No es un detalle de
// estilo: el id de un paso configurable lo escribe un admin en el panel y su
// esquema no restringe caracteres, así que como segmento de URL rompería el
// routing con un id que la base considera válido. Y al no navegar, saltar de
// módulo no remonta la pantalla — que es literalmente lo que pide el criterio
// "lo capturado no se pierde al saltar".

export default function VisitaLevantamiento() {
  const router = useRouter();
  const sesion = useSesion();
  const { visitaId } = useLocalSearchParams<{ visitaId: string }>();

  const { visita } = useVisita(visitaId);
  const { marcas, cargando } = useMarcasDeVisita(visitaId);
  const definiciones = useDefinicionesDeVisita(visitaId);
  const hechos = useModulosHechosDeVisita(visitaId);
  const contingencias = useContingenciasDeVisita(visitaId);

  const [abierto, setAbierto] = useState<{
    idModulo: string;
    marcaId: string;
  } | null>(null);

  // Cada marca necesita su levantamiento para que sus módulos configurables se
  // resuelvan (cuelgan de la versión de formulario anclada). `crearLevantamiento`
  // es idempotente, así que llamarlo por cada marca en cada render es seguro.
  useEffect(() => {
    if (!visita) return;
    for (const marca of marcas) {
      if (marca.levantamiento_id) continue;
      void crearLevantamiento({
        tenant_id: visita.tenant_id,
        visita_id: visitaId,
        marca_id: marca.id,
      });
    }
  }, [visita, marcas, visitaId]);

  // El estado de cada módulo en cada marca. Un solo calculador
  // (`estadoDeModulos`) sobre dos consultas por visita: nada de N+1 por marca.
  const porMarca = useMemo(
    () =>
      marcas.map((marca) => {
        // `construirPasos` sigue siendo el único que arma la lista de módulos:
        // los cinco fijos más los configurables de ESTA marca.
        const modulos = construirPasos(definiciones.get(marca.id) ?? null);
        return {
          marca,
          modulos,
          estados: estadoDeModulos(
            modulos,
            soloDe(hechos, marca.levantamiento_id),
            soloDe(contingencias, marca.levantamiento_id),
          ),
        };
      }),
    [marcas, definiciones, hechos, contingencias],
  );

  // El menú se organiza por MÓDULO, con sus marcas dentro. Es el giro del
  // acuerdo: antes la lista de primer nivel eran las marcas.
  const modulosDelMenu: ModuloDelMenu[] = useMemo(() => {
    const porModulo = new Map<string, ModuloDelMenu>();
    for (const { marca, modulos, estados } of porMarca) {
      for (const modulo of modulos) {
        const entrada = porModulo.get(modulo.id) ?? { modulo, marcas: [] };
        entrada.marcas.push({
          marca,
          progreso: estados.get(modulo.id) ?? { estado: "pendiente" },
        });
        porModulo.set(modulo.id, entrada);
      }
    }
    return [...porModulo.values()];
  }, [porMarca]);

  const todoListo =
    porMarca.length > 0 && porMarca.every((m) => marcaCompleta(m.estados));

  // Cierra el levantamiento de cada marca en cuanto todos sus módulos están
  // completados u omitidos. `completarLevantamiento` es un UPDATE por id: volver
  // a llamarlo sobre una marca ya cerrada no duplica nada.
  useEffect(() => {
    for (const { marca, estados } of porMarca) {
      const yaCerrada =
        marca.levantamiento_estado === "completado" ||
        marca.levantamiento_estado === "omitido";
      if (yaCerrada || !marca.levantamiento_id || !marcaCompleta(estados)) {
        continue;
      }
      void completarLevantamiento(marca.levantamiento_id);
    }
  }, [porMarca]);

  const cerrarModulo = useCallback(() => setAbierto(null), []);

  // El botón atrás de Android con un módulo abierto vuelve al menú, no saca de
  // la visita. Sin esto, el mercaderista sale de la pantalla creyendo que
  // retrocede un paso.
  useEffect(() => {
    if (!abierto) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      cerrarModulo();
      return true;
    });
    return () => sub.remove();
  }, [abierto, cerrarModulo]);

  const activo = abierto
    ? porMarca.find((m) => m.marca.id === abierto.marcaId)
    : undefined;
  const moduloActivo = activo?.modulos.find((m) => m.id === abierto?.idModulo);

  return (
    <View style={e.pantalla}>
      {moduloActivo && activo && visita ? (
        <ModuloActivo
          modulo={moduloActivo}
          marcas={marcas}
          marcaId={activo.marca.id}
          progreso={
            activo.estados.get(moduloActivo.id) ?? { estado: "pendiente" }
          }
          visitaId={visitaId}
          tenantId={visita.tenant_id}
          usuario={sesion?.user.email ?? "Mercaderista"}
          onCambiarMarca={(marcaId) =>
            setAbierto({ idModulo: moduloActivo.id, marcaId })
          }
          onCompletar={(levantamientoId) => {
            void marcarModuloHecho({
              tenant_id: visita.tenant_id,
              levantamiento_id: levantamientoId,
              paso: moduloActivo.paso,
              paso_config_id:
                moduloActivo.tipo === "configurable" ? moduloActivo.id : null,
            });
            cerrarModulo();
          }}
          onVolver={cerrarModulo}
        />
      ) : (
        <>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            style={e.volver}
          >
            <Text style={e.volverTexto}>‹ Mi día</Text>
          </Pressable>
          <View style={e.tituloFila}>
            <Text style={e.titulo}>Levantamiento</Text>
            <AyudaBoton clave="seleccion_marca" />
          </View>
          <Text style={e.subtitulo}>
            Entra a los módulos en el orden que puedas.
          </Text>

          <MenuVisita
            modulos={modulosDelMenu}
            cargando={cargando}
            todoListo={todoListo}
            onAbrir={(idModulo, marcaId) => setAbierto({ idModulo, marcaId })}
            onCheckOut={() => router.push(`/check-out/${visitaId}`)}
          />
        </>
      )}
    </View>
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: colores.fondo, padding: espacio.m },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  tituloFila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: espacio.s,
  },
  titulo: { color: colores.texto, fontSize: 24, fontWeight: "800" },
  subtitulo: { color: colores.textoSuave, fontSize: 14, marginTop: 2 },
});
