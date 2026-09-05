import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";

import { AyudaBoton } from "@/componentes/ayuda-boton";
import { MenuVisita } from "@/componentes/menu-visita";
import { ListaIncidencias } from "@/componentes/lista-incidencias";
import { ModuloActivo } from "@/componentes/modulo-activo";
import { ResolverIncidencia } from "@/componentes/resolver-incidencia";
import {
  completarLevantamiento,
  crearLevantamiento,
  useContingenciasDeVisita,
  useDefinicionesDeVisita,
  useMarcasDeVisita,
  useVisita,
} from "@/lib/levantamiento";
import { mensajeDeError } from "@/lib/error";
import { type IncidenciaLocal, useResumenIncidencias } from "@/lib/incidencias";
import {
  armarMenuDeVisita,
  marcaCompleta,
  marcarModuloHecho,
  useModulosHechosDeVisita,
} from "@/lib/progreso-visita";
import { useEstadoSync } from "@/lib/powersync/estado";
import { useSesion } from "@/sesion";
import { colores, espacio, radio } from "@/tema";

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
  const {
    visitaId,
    incidencias: abrirIncidencias,
    hallazgo: hallazgoPedido,
  } = useLocalSearchParams<{
    visitaId: string;
    incidencias?: string;
    hallazgo?: string;
  }>();

  const { visita } = useVisita(visitaId);
  const { marcas, cargando } = useMarcasDeVisita(visitaId);
  const definiciones = useDefinicionesDeVisita(visitaId);
  const hechos = useModulosHechosDeVisita(visitaId);
  const contingencias = useContingenciasDeVisita(visitaId);

  const [abierto, setAbierto] = useState<{
    idModulo: string;
    marcaId: string;
  } | null>(null);
  // La pestaña de incidencias es un tercer estado de ESTA pantalla, no una ruta:
  // así se puede abrir con un módulo abierto y volver a él, en vez de al menú.
  const [verIncidencias, setVerIncidencias] = useState(
    abrirIncidencias === "1",
  );
  const [atendiendo, setAtendiendo] = useState<IncidenciaLocal | null>(null);

  // El check-out enlaza aquí con `?incidencias=1&hallazgo=<id>` para llevar al
  // mercaderista directo a lo que le falta cerrar.
  //
  // Va en un efecto y NO solo en el inicializador de `useState`: la pantalla ya
  // está en la pila —al check-out se llega desde ella— así que un `push` no
  // garantiza remontarla, y el estado se quedaría pegado del primer montaje. El
  // segundo toque parecería ignorado y aterrizaría en el menú de módulos.
  useEffect(() => {
    if (abrirIncidencias !== "1") return;
    setVerIncidencias(true);
  }, [abrirIncidencias, hallazgoPedido]);
  const {
    incidencias,
    pendientes,
    cargando: cargandoInc,
    error: errorInc,
  } = useResumenIncidencias(visitaId);
  const { conectado } = useEstadoSync();

  // Cada marca necesita su levantamiento para que sus módulos configurables se
  // resuelvan (cuelgan de la versión de formulario anclada). `crearLevantamiento`
  // es idempotente, así que llamarlo por cada marca en cada render es seguro.
  useEffect(() => {
    if (!visita) return;
    for (const marca of marcas) {
      if (marca.levantamiento_id) continue;
      // El `.catch` no es decorativo: sin él un fallo aquí es una promesa no
      // atrapada, y lo único que vería el mercaderista es una marca que se queda
      // en "Preparando…" para siempre, sin saber por qué.
      crearLevantamiento({
        tenant_id: visita.tenant_id,
        visita_id: visitaId,
        marca_id: marca.id,
      }).catch((err: unknown) => {
        console.error(
          `[levantamiento] no se pudo abrir la marca ${marca.id}: ${mensajeDeError(err)}`,
        );
      });
    }
  }, [visita, marcas, visitaId]);

  // El menú entero —el pivote a módulo-mayor, el estado por marca y si ya se
  // puede ir al check-out— lo arma una función pura con su propio test. Aquí
  // solo se memoiza.
  const menu = useMemo(
    () => armarMenuDeVisita(marcas, definiciones, hechos, contingencias),
    [marcas, definiciones, hechos, contingencias],
  );

  // Cierra el levantamiento de cada marca en cuanto todos sus módulos están
  // completados u omitidos. `completarLevantamiento` es un UPDATE por id: volver
  // a llamarlo sobre una marca ya cerrada no duplica nada.
  useEffect(() => {
    for (const { marca, estados } of menu.porMarca) {
      const yaCerrada =
        marca.levantamiento_estado === "completado" ||
        marca.levantamiento_estado === "omitido";
      if (yaCerrada || !marca.levantamiento_id || !marcaCompleta(estados)) {
        continue;
      }
      completarLevantamiento(marca.levantamiento_id).catch((err: unknown) => {
        console.error(
          `[levantamiento] no se pudo cerrar la marca ${marca.id}: ${mensajeDeError(err)}`,
        );
      });
    }
  }, [menu]);

  const cerrarModulo = useCallback(() => setAbierto(null), []);

  // El botón atrás de Android con un módulo abierto vuelve al menú, no saca de
  // la visita. Sin esto, el mercaderista sale de la pantalla creyendo que
  // retrocede un paso.
  useEffect(() => {
    if (!abierto && !verIncidencias) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      // Prioridad: incidencias → módulo → salir. La pestaña se abre ENCIMA de un
      // módulo, así que cerrarla tiene que devolver al módulo, no al menú.
      if (verIncidencias) setVerIncidencias(false);
      else cerrarModulo();
      return true;
    });
    return () => sub.remove();
  }, [abierto, verIncidencias, cerrarModulo]);

  const activo = abierto
    ? menu.porMarca.find((m) => m.marca.id === abierto.marcaId)
    : undefined;
  const moduloActivo = activo?.modulos.find((m) => m.id === abierto?.idModulo);

  return (
    <View style={e.pantalla}>
      {/* Fuera del ternario a propósito: el contador tiene que verse también con
          un módulo abierto. "Independientemente del módulo donde surja la
          incidencia, esta debe acumularse en una lista global." */}
      {!verIncidencias ? (
        <Pressable
          onPress={() => setVerIncidencias(true)}
          accessibilityRole="button"
          accessibilityLabel={
            pendientes > 0
              ? `Incidencias, ${pendientes} pendientes`
              : "Incidencias"
          }
          style={e.barraIncidencias}
        >
          <Text style={e.barraTexto}>Incidencias</Text>
          {pendientes > 0 ? (
            <View style={e.contador}>
              <Text style={e.contadorTexto}>{pendientes} pendientes</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {verIncidencias ? (
        <>
          <ListaIncidencias
            incidencias={incidencias}
            cargando={cargandoInc}
            error={errorInc}
            conectado={conectado}
            onResolver={setAtendiendo}
            onVolver={() => setVerIncidencias(false)}
          />
          {atendiendo && visita ? (
            <ResolverIncidencia
              incidencia={atendiendo}
              visible={true}
              tenantId={visita.tenant_id}
              usuario={sesion?.user.email ?? "Mercaderista"}
              onAtendida={() => setAtendiendo(null)}
              onCancelar={() => setAtendiendo(null)}
            />
          ) : null}
        </>
      ) : moduloActivo && activo && visita ? (
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
            marcarModuloHecho({
              tenant_id: visita.tenant_id,
              levantamiento_id: levantamientoId,
              paso: moduloActivo.paso,
              paso_config_id:
                moduloActivo.tipo === "configurable" ? moduloActivo.id : null,
            }).catch((err: unknown) => {
              console.error(
                `[levantamiento] no se pudo cerrar el módulo ${moduloActivo.id}: ${mensajeDeError(err)}`,
              );
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
            modulos={menu.modulos}
            cargando={cargando}
            todoListo={menu.todoListo}
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
  barraIncidencias: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: espacio.m,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
    marginBottom: espacio.s,
  },
  barraTexto: { color: colores.texto, fontSize: 15, fontWeight: "700" },
  contador: {
    borderRadius: radio.m,
    backgroundColor: colores.alerta,
    paddingHorizontal: espacio.s,
    paddingVertical: 2,
  },
  // El número va como TEXTO dentro de la pastilla: el color solo no le dice
  // nada a quien no lo distingue (WCAG 1.4.1).
  contadorTexto: { color: colores.marcaTexto, fontSize: 12, fontWeight: "700" },
  subtitulo: { color: colores.textoSuave, fontSize: 14, marginTop: 2 },
});
