"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { topicoStaff } from "@market-track/shared";

import { MapaPines } from "@/components/mapa/mapa-pines";
import { Aviso } from "@/components/panel/tabla";
import {
  aplicarCambioDeVisita,
  colorDeVisita,
  marcarAtendida,
  textoDeVisita,
  type Contingencia,
  type FilaTablero,
} from "@/lib/panel/tablero";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

import { FeedContingencias } from "./feed-contingencias";
import { TablaVisitas } from "./tabla-visitas";

// El tablero en vivo. La carga inicial la hace el servidor y llega por props; a
// partir de ahí, los canales privados de Realtime (MAR-61) van actualizando.
//
// `staff:visita` trae los check-in y check-out; `staff:alerta`, las alertas del
// motor. Son canales PRIVADOS: hay que llamar a `setAuth()` antes de suscribirse
// o Realtime no evalúa la RLS y rechaza el join.
//
// El broadcast trae la fila cruda de la tabla, que NO es la fila del tablero (sin
// nombre de mercaderista, sin fotos, sin motivo). Por eso una visita que ya está
// en pantalla se refresca en el sitio y una que no está se ignora: la traerá la
// siguiente carga del servidor, entera. Es la diferencia entre un tablero que se
// actualiza y uno que se va llenando de filas a medias.

type CambioVisita = {
  record?: { id?: string; estado?: string; check_out_at?: string | null };
};

export function TableroVivo({
  filasIniciales,
  contingenciasIniciales,
  urlTiles,
}: {
  filasIniciales: FilaTablero[];
  contingenciasIniciales: Contingencia[];
  urlTiles: string | undefined;
}) {
  const [filas, setFilas] = useState(filasIniciales);
  const [contingencias, setContingencias] = useState(contingenciasIniciales);
  const router = useRouter();
  const recargaPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Si el servidor vuelve a renderizar (revalidatePath tras marcar atendida),
  // las props mandan sobre lo que haya acumulado el vivo.
  useEffect(() => setFilas(filasIniciales), [filasIniciales]);
  useEffect(
    () => setContingencias(contingenciasIniciales),
    [contingenciasIniciales],
  );

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let vivo = true;

    async function suscribir() {
      await supabase.realtime.setAuth();
      if (!vivo) return;

      const canalVisitas = supabase
        .channel(topicoStaff("visita"), { config: { private: true } })
        .on("broadcast", { event: "INSERT" }, pedirRecarga)
        .on("broadcast", { event: "UPDATE" }, ({ payload }) =>
          aplicarVisita(payload as CambioVisita),
        )
        .subscribe();

      const canalAlertas = supabase
        .channel(topicoStaff("alerta"), { config: { private: true } })
        .on("broadcast", { event: "INSERT" }, pedirRecarga)
        .subscribe();

      return () => {
        void supabase.removeChannel(canalVisitas);
        void supabase.removeChannel(canalAlertas);
      };
    }

    const limpieza = suscribir();
    return () => {
      vivo = false;
      if (recargaPendiente.current) clearTimeout(recargaPendiente.current);
      void limpieza.then((fn) => fn?.());
    };
    // Se suscribe una vez: los topics son fijos y no dependen de los datos.
  }, []);

  function aplicarVisita(evento: CambioVisita) {
    const fila = evento.record;
    if (!fila?.id || !fila.estado) return;
    setFilas((actuales) =>
      aplicarCambioDeVisita(actuales, {
        id: fila.id as string,
        estado: fila.estado as FilaTablero["estado"],
        check_out_at: fila.check_out_at ?? null,
      }),
    );
  }

  // Una visita o una contingencia NUEVA no se puede pintar desde el broadcast:
  // le faltan el mercaderista, la tienda y el motivo, que viven en otras tablas.
  // Se le pide al servidor que rehaga la página en vez de inventar una fila a
  // medias. Con retardo: en un check-in llegan el evento de `visita` y el de la
  // `alerta` casi a la vez, y no hacen falta dos recargas.
  function pedirRecarga() {
    if (recargaPendiente.current) clearTimeout(recargaPendiente.current);
    recargaPendiente.current = setTimeout(() => router.refresh(), 400);
  }

  const pines = filas
    .filter((f) => f.tienda_lat !== null && f.tienda_lon !== null)
    .map((f) => ({
      id: f.tienda_id,
      nombre: f.tienda_nombre,
      lat: f.tienda_lat as number,
      lon: f.tienda_lon as number,
      color: colorDeVisita(f.estado),
      href: `/admin/catalogo/tiendas/${f.tienda_id}`,
      descripcion: textoDeVisita(f.estado),
    }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {urlTiles ? (
            <MapaPines
              urlTiles={urlTiles}
              pines={pines}
              textoEnlace="Ver la tienda"
              etiqueta="Tiendas del día por estado de visita"
            />
          ) : (
            <Aviso>No hay mapa base configurado para este entorno.</Aviso>
          )}
        </div>
        <FeedContingencias
          contingencias={contingencias}
          onAtendida={(id) =>
            setContingencias((actuales) => marcarAtendida(actuales, id))
          }
        />
      </div>
      <TablaVisitas filas={filas} />
    </div>
  );
}
