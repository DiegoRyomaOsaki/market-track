import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ContingenciaModal } from "@/componentes/contingencia-modal";
import { PasoAntesSos } from "@/componentes/paso-antes-sos";
import { PasoConfigurable } from "@/componentes/paso-configurable";
import { PasoDespues } from "@/componentes/paso-despues";
import { PasoExhibiciones } from "@/componentes/paso-exhibiciones";
import { PasoPrecios } from "@/componentes/paso-precios";
import { PasoQuiebres } from "@/componentes/paso-quiebres";
import type { MarcaAuditable } from "@/lib/levantamiento";
import type { PasoWizard } from "@/lib/pasos-levantamiento";
import type { ProgresoModulo } from "@/lib/progreso-visita";
import { colores, espacio, radio } from "@/tema";

// Un módulo abierto, con su selector de marca dentro.
//
// Es la mitad del acuerdo que el ticket cita textualmente: "yo dentro del módulo
// de exhibición de góndola puedo poner marca B, marca C… sigo en el módulo de
// exhibición, pero tengo que cambiar la marca".
//
// El `levantamiento_id` que reciben el paso y la contingencia sale SIEMPRE de la
// marca seleccionada aquí. Pasar el de otra marca no falla ni avisa: atribuye el
// trabajo —o el bypass, y su alerta al supervisor— a la marca equivocada, en
// silencio. Es el fallo más caro de esta pantalla y por eso vive en un
// componente que se puede probar, no en el fichero de ruta.

export function ModuloActivo({
  modulo,
  marcas,
  marcaId,
  progreso,
  visitaId,
  tenantId,
  usuario,
  onCambiarMarca,
  onCompletar,
  onVolver,
}: {
  modulo: PasoWizard;
  marcas: readonly MarcaAuditable[];
  marcaId: string;
  /** El estado de ESTE módulo en la marca seleccionada. */
  progreso: ProgresoModulo;
  visitaId: string;
  tenantId: string;
  usuario: string;
  onCambiarMarca: (marcaId: string) => void;
  onCompletar: (levantamientoId: string) => void;
  onVolver: () => void;
}) {
  const [mostrarContingencia, setMostrarContingencia] = useState(false);
  const marca = marcas.find((m) => m.id === marcaId) ?? null;
  const levantamientoId = marca?.levantamiento_id ?? null;
  const pasoConfigId = modulo.tipo === "configurable" ? modulo.id : null;

  return (
    <View style={e.pantalla}>
      <Pressable
        onPress={onVolver}
        hitSlop={8}
        accessibilityRole="button"
        style={e.volver}
      >
        <Text style={e.volverTexto}>‹ Módulos</Text>
      </Pressable>
      <Text style={e.titulo}>{modulo.titulo}</Text>

      {/* El selector de marca vive DENTRO del módulo: cambiar de marca no
          saca al mercaderista de donde está trabajando. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={e.marcas}
      >
        {marcas.map((m) => {
          const activa = m.id === marcaId;
          return (
            <Pressable
              key={m.id}
              onPress={() => onCambiarMarca(m.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: activa }}
              accessibilityLabel={`Marca ${m.nombre}`}
              style={[e.pastilla, activa && e.pastillaActiva]}
            >
              <Text style={[e.pastillaTexto, activa && e.pastillaTextoActiva]}>
                {m.nombre}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!marca || !levantamientoId ? (
        <View style={e.centro}>
          <Text style={e.nota}>Preparando la marca…</Text>
        </View>
      ) : (
        <>
          {progreso.motivoOmision ? (
            <Text style={e.motivo}>
              Se omitió antes: {progreso.motivoOmision}
            </Text>
          ) : null}

          <View style={e.contenido}>
            <PasoDeModulo
              // Remonta al cambiar de marca: cada paso resiembra su estado desde
              // la réplica local, así que sin esta clave se quedaría pintando lo
              // de la marca anterior.
              key={marcaId}
              modulo={modulo}
              visitaId={visitaId}
              marcaId={marcaId}
              levantamientoId={levantamientoId}
              tenantId={tenantId}
              usuario={usuario}
              onCompletar={() => onCompletar(levantamientoId)}
              onContingencia={() => setMostrarContingencia(true)}
            />
          </View>

          {/* Un módulo ya omitido no vuelve a ofrecer el bypass: una segunda
              contingencia mandaría una alerta duplicada al supervisor, y la
              tabla no tiene ninguna verja que lo impida. */}
          {progreso.estado === "omitido" ? null : (
            <ContingenciaModal
              visible={mostrarContingencia}
              paso={modulo.paso}
              pasoConfigId={pasoConfigId}
              tituloPaso={modulo.titulo}
              usuario={usuario}
              tenant_id={tenantId}
              visita_id={visitaId}
              levantamiento_id={levantamientoId}
              onRegistrada={() => {
                setMostrarContingencia(false);
                onVolver();
              }}
              onCancelar={() => setMostrarContingencia(false)}
            />
          )}
        </>
      )}
    </View>
  );
}

/** Despacha al componente del módulo. Mismo reparto que tenía el wizard. */
function PasoDeModulo({
  modulo,
  visitaId,
  marcaId,
  levantamientoId,
  tenantId,
  usuario,
  onCompletar,
  onContingencia,
}: {
  modulo: PasoWizard;
  visitaId: string;
  marcaId: string;
  levantamientoId: string;
  tenantId: string;
  usuario: string;
  onCompletar: () => void;
  onContingencia: () => void;
}) {
  if (modulo.tipo === "configurable") {
    return (
      <PasoConfigurable
        paso={modulo}
        visitaId={visitaId}
        levantamientoId={levantamientoId}
        tenantId={tenantId}
        usuario={usuario}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }

  const comun = { visitaId, marcaId, levantamientoId, tenantId };
  if (modulo.id === "antes") {
    return (
      <PasoAntesSos
        {...comun}
        usuario={usuario}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }
  if (modulo.id === "quiebres") {
    return (
      <PasoQuiebres
        {...comun}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }
  if (modulo.id === "precios") {
    return (
      <PasoPrecios
        {...comun}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }
  if (modulo.id === "exhibiciones") {
    return (
      <PasoExhibiciones
        {...comun}
        usuario={usuario}
        onCompletar={onCompletar}
        onContingencia={onContingencia}
      />
    );
  }
  return (
    <PasoDespues
      {...comun}
      usuario={usuario}
      onCompletar={onCompletar}
      onContingencia={onContingencia}
    />
  );
}

const e = StyleSheet.create({
  pantalla: { flex: 1 },
  volver: { paddingVertical: espacio.s },
  volverTexto: { color: colores.textoSuave, fontSize: 15, fontWeight: "600" },
  titulo: {
    color: colores.texto,
    fontSize: 22,
    fontWeight: "800",
    marginTop: espacio.xs,
  },
  marcas: { gap: espacio.xs, paddingVertical: espacio.s },
  pastilla: {
    paddingHorizontal: espacio.m,
    paddingVertical: espacio.xs,
    borderRadius: radio.m,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  pastillaActiva: {
    backgroundColor: colores.marca,
    borderColor: colores.marca,
  },
  pastillaTexto: { color: colores.texto, fontSize: 14, fontWeight: "600" },
  pastillaTextoActiva: { color: colores.marcaTexto },
  contenido: { marginTop: espacio.m, flex: 1 },
  centro: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: espacio.xl,
  },
  nota: { color: colores.textoSuave, fontSize: 14 },
  motivo: {
    color: colores.alerta,
    fontSize: 13,
    lineHeight: 18,
    marginTop: espacio.xs,
  },
});
