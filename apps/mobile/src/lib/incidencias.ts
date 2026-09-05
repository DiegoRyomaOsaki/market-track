import {
  detalleIncidenciaSchema,
  diaEnLima,
  type EstadoIncidencia,
  type OrigenIncidencia,
} from "@market-track/shared";
import { useQuery } from "@powersync/react-native";
import * as Crypto from "expo-crypto";
import { useMemo } from "react";

import { encolarFoto } from "./cola-fotos-instancia";
import type { FotoCapturada } from "./foto-captura";
import {
  type ContextoPrecio,
  type HallazgoDerivado,
  hallazgosDeExhibicion,
  hallazgosDeSku,
} from "./hallazgos";
import { db } from "./powersync/db";

// La lista global de incidencias de una visita, y su resolución.
//
// El acuerdo de la 4ª revisión: la incidencia no se cierra diciendo "ya está",
// se cierra con la acción tomada y una foto. Y la lista es de la VISITA, no del
// módulo — "si estabas en góndola y pasó una hora, en tu cabeza no vas a decir
// «tenía que entrar a góndola porque ahí tenía la incidencia»".
//
// El hallazgo lo produce el motor en la base; aquí se LEE y, mientras su fila no
// ha llegado, se ESPEJA de forma efímera (`hallazgos.ts`) para que una visita
// hecha sin señal no se vea igual que una sin hallazgos.
//
// La atención NO se escribe sobre `incidencia`: va a `atencion_hallazgo`, con la
// clave natural del hallazgo. Un `UPDATE incidencia … WHERE id = ?` sin señal
// afecta a cero filas, PowerSync no encola nada, y la acción del mercaderista se
// perdería sin un solo mensaje. Una puerta, un dueño. Ver docs/adr/0012.

/** Una incidencia tal como baja a la réplica, con lo que hace falta pintarla. */
export type IncidenciaLocal = {
  id: string;
  visita_id: string;
  levantamiento_id: string | null;
  sku_id: string | null;
  exhibicion_negociada_id: string | null;
  marca_id: string | null;
  marca_nombre: string | null;
  sku_nombre: string | null;
  origen: OrigenIncidencia;
  estado: EstadoIncidencia;
  detalle: string | null;
  accion_tomada: string | null;
  motivo: string | null;
  creado_at: string;
  /**
   * Derivada en el teléfono porque su fila del servidor todavía no ha llegado.
   *
   * Se pinta igual, pero no tiene `id` de incidencia: la atención se declara por
   * la clave natural del hallazgo. Ver docs/adr/0012.
   */
  derivada: boolean;
  /** Atendida aquí y aún sin confirmar por el servidor. */
  atendidaSinSincronizar: boolean;
};

/** La clave natural del hallazgo: lo que casa el derivado con el del servidor. */
export type ClaveHallazgo = {
  levantamiento_id: string | null;
  sku_id: string | null;
  exhibicion_negociada_id: string | null;
  origen: OrigenIncidencia;
};

/**
 * Las incidencias de TODA la visita, en una sola consulta.
 *
 * Por visita y no por marca: la lista las agrupa después en memoria, y una
 * consulta por marca sería un N+1 sobre la réplica en el camino de pintado.
 *
 * `anulada` se excluye aquí y no en quien pinta: es una incidencia que dejó de
 * existir porque el mercaderista corrigió el dato, y no tiene nada que decirle.
 */
export function useIncidenciasDeVisita(visitaId: string) {
  const { data, isLoading, error } = useQuery<IncidenciaLocal>(
    `SELECT i.id, i.visita_id, i.levantamiento_id, i.sku_id,
            i.exhibicion_negociada_id, i.marca_id,
            m.nombre AS marca_nombre, s.nombre AS sku_nombre,
            i.origen, i.estado, i.detalle, i.accion_tomada, i.motivo, i.creado_at,
            0 AS derivada, 0 AS atendidaSinSincronizar
       FROM incidencia i
       LEFT JOIN marca m ON m.id = i.marca_id
       LEFT JOIN sku s ON s.id = i.sku_id
      WHERE i.visita_id = ? AND i.estado <> 'anulada'
      ORDER BY i.creado_at`,
    [visitaId],
  );

  const { derivados, cargando: cargandoDerivados } =
    useHallazgosDerivados(visitaId);
  const {
    data: atenciones,
    isLoading: cargandoAtenciones,
    error: errorAtenciones,
  } = useQuery<ClaveHallazgo>(
    `SELECT levantamiento_id, sku_id, exhibicion_negociada_id, origen
       FROM atencion_hallazgo
      WHERE visita_id = ? AND aplicada_at IS NULL`,
    [visitaId],
  );

  const incidencias = useMemo(
    () => unirHallazgos(data ?? [], derivados, atenciones ?? []),
    [data, derivados, atenciones],
  );

  // `cargando` cubre TODAS las consultas, no solo la del servidor: con la de
  // `incidencia` resuelta en vacío y las derivadas aún en vuelo, la lista
  // afirmaría "nada que atender" y el contador de pendientes daría cero — que es
  // por donde una verja de check-out dejaría salir.
  return {
    incidencias,
    cargando: isLoading || cargandoDerivados || cargandoAtenciones,
    error: error
      ? String(error)
      : errorAtenciones
        ? String(errorAtenciones)
        : null,
  };
}

type FilaDerivada = {
  levantamiento_id: string;
  sku_id: string | null;
  marca_id: string | null;
  marca_nombre: string | null;
  sku_nombre: string | null;
  tolerancia_precio_pct: number | null;
  stock_sistema: number | null;
  stock_piso: number | null;
  precio_registrado: number | null;
  hay_promo: number | null;
  promo_comunicada: number | null;
};

/**
 * Los hallazgos que el teléfono deriva de lo que ya tiene en la réplica.
 *
 * Existen porque la `incidencia` la crea un trigger que corre cuando la fila
 * llega al SERVIDOR: en una visita hecha entera sin señal no hay ninguna, y la
 * lista se ve igual que una visita sin hallazgos. Ver docs/adr/0012.
 *
 * **La fecha es la del check-in declarado.** El servidor evalúa con
 * `check_in_recibido_at` —el instante en que la visita LLEGA— y el teléfono no lo
 * tiene ni podría: es un sello anti-falsificación. En una visita rezagada son
 * días distintos, así que el veredicto derivado puede diferir del definitivo. Se
 * acepta a propósito: lo derivado es efímero y se corrige solo al sincronizar.
 *
 * Una consulta por visita, no una por SKU: derivar está en el camino de pintado.
 */
function useHallazgosDerivados(visitaId: string): {
  derivados: IncidenciaLocal[];
  cargando: boolean;
} {
  const { data: visita, isLoading: cargandoVisita } = useQuery<{
    check_in_at: string | null;
    tenant_id: string | null;
    cadena_id: string | null;
  }>(
    `SELECT v.check_in_at, t.tenant_id, t.cadena_id
       FROM visita v LEFT JOIN tienda t ON t.id = v.tienda_id
      WHERE v.id = ?`,
    [visitaId],
  );
  const cadenaId = visita?.[0]?.cadena_id ?? null;

  const { data: filas, isLoading: cargandoFilas } = useQuery<FilaDerivada>(
    `SELECT ls.levantamiento_id, ls.sku_id, l.marca_id,
            m.nombre AS marca_nombre, s.nombre AS sku_nombre,
            m.tolerancia_precio_pct,
            ls.stock_sistema, ls.stock_piso, ls.precio_registrado,
            ls.hay_promo, ls.promo_comunicada
       FROM levantamiento_sku ls
       JOIN levantamiento l ON l.id = ls.levantamiento_id
       LEFT JOIN marca m ON m.id = l.marca_id
       LEFT JOIN sku s ON s.id = ls.sku_id
      WHERE l.visita_id = ?`,
    [visitaId],
  );

  const { data: exhibiciones, isLoading: cargandoExh } = useQuery<{
    levantamiento_id: string;
    exhibicion_negociada_id: string | null;
    instalada: number | null;
    unidades: number | null;
    marca_id: string | null;
    marca_nombre: string | null;
  }>(
    `SELECT e.levantamiento_id, e.exhibicion_negociada_id, e.instalada,
            e.unidades, l.marca_id, m.nombre AS marca_nombre
       FROM exhibicion e
       JOIN levantamiento l ON l.id = e.levantamiento_id
       LEFT JOIN marca m ON m.id = l.marca_id
      WHERE l.visita_id = ?`,
    [visitaId],
  );

  // Acotados a los SKU de ESTA visita y, en el caso del precio, a su cadena. Sin
  // el filtro por SKU el espejo compara el precio de un SKU contra el periodo de
  // otro —y una promo ajena justifica un precio bajo real—, porque el stream baja
  // el maestro del cliente entero. El SQL autoritativo filtra por
  // `tenant_id AND sku_id AND cadena_id`; esto tiene que filtrar igual.
  const { data: periodos, isLoading: cargandoPrecios } = useQuery<{
    sku_id: string;
    precio: number;
    vigente_desde: string;
    vigente_hasta: string | null;
    tipo_tienda: string | null;
  }>(
    `SELECT pr.sku_id, pr.precio, pr.vigente_desde, pr.vigente_hasta,
            pr.tipo_tienda
       FROM precio_regular pr
      WHERE pr.cadena_id = ?
        AND pr.sku_id IN (SELECT ls.sku_id FROM levantamiento_sku ls
                            JOIN levantamiento l ON l.id = ls.levantamiento_id
                           WHERE l.visita_id = ?)`,
    [cadenaId ?? "", visitaId],
  );

  const { data: promociones, isLoading: cargandoPromos } = useQuery<{
    sku_id: string;
    precio_promo: number;
    fecha_inicio: string;
    fecha_fin: string;
    comunicada: number;
  }>(
    `SELECT p.sku_id, p.precio_promo, p.fecha_inicio, p.fecha_fin, p.comunicada
       FROM promocion p
      WHERE p.sku_id IN (SELECT ls.sku_id FROM levantamiento_sku ls
                           JOIN levantamiento l ON l.id = ls.levantamiento_id
                          WHERE l.visita_id = ?)`,
    [visitaId],
  );

  // Mientras alguno de los insumos no ha resuelto, la derivación NO se hace: con
  // la cadena a medias todos los SKU darían `sin_precio_vigente` y la lista
  // afirmaría "nada que atender" durante un frame — el mismo fallo que este
  // módulo existe para quitar, entrando por la puerta del primer render.
  const cargando =
    cargandoVisita ||
    cargandoFilas ||
    cargandoExh ||
    cargandoPrecios ||
    cargandoPromos;

  const derivados = useMemo(() => {
    if (cargando) return [];
    const fecha = diaEnLima(
      visita?.[0]?.check_in_at ? new Date(visita[0].check_in_at) : new Date(),
    );

    // Indexados UNA vez: sin esto cada SKU recorre el maestro entero, y son
    // decenas de SKU por visita.
    const porSku = <T extends { sku_id: string }>(filas: readonly T[]) => {
      const mapa = new Map<string, T[]>();
      for (const f of filas) {
        const previas = mapa.get(f.sku_id) ?? [];
        previas.push(f);
        mapa.set(f.sku_id, previas);
      }
      return mapa;
    };
    const preciosPorSku = porSku(periodos ?? []);
    const promosPorSku = porSku(
      (promociones ?? []).map((p) => ({
        ...p,
        comunicada: p.comunicada === 1,
      })),
    );

    const pintable = (
      h: HallazgoDerivado,
      marcaId: string | null,
      marcaNombre: string | null,
      skuNombre: string | null,
    ): IncidenciaLocal => ({
      // No hay id de incidencia: la fila del servidor no existe todavía. La
      // atención se declara por la clave natural, no por este id.
      id: `derivada:${h.levantamientoId ?? ""}:${h.skuId ?? ""}:${h.exhibicionNegociadaId ?? ""}:${h.origen}`,
      visita_id: visitaId,
      levantamiento_id: h.levantamientoId,
      sku_id: h.skuId,
      exhibicion_negociada_id: h.exhibicionNegociadaId,
      marca_id: marcaId,
      marca_nombre: marcaNombre,
      sku_nombre: skuNombre,
      origen: h.origen,
      estado: "pendiente",
      detalle: JSON.stringify(h.detalle),
      accion_tomada: null,
      motivo: null,
      creado_at: fecha,
      derivada: true,
      atendidaSinSincronizar: false,
    });

    const salida: IncidenciaLocal[] = [];
    for (const f of filas ?? []) {
      const contexto: ContextoPrecio = {
        fecha,
        periodos: preciosPorSku.get(f.sku_id ?? "") ?? [],
        promociones: promosPorSku.get(f.sku_id ?? "") ?? [],
        toleranciaPct: f.tolerancia_precio_pct ?? 0,
      };
      for (const h of hallazgosDeSku(
        { ...f, sku_id: f.sku_id ?? "" },
        contexto,
      )) {
        salida.push(pintable(h, f.marca_id, f.marca_nombre, f.sku_nombre));
      }
    }
    for (const e of exhibiciones ?? []) {
      for (const h of hallazgosDeExhibicion(e)) {
        salida.push(pintable(h, e.marca_id, e.marca_nombre, null));
      }
    }
    return salida;
  }, [cargando, visitaId, visita, filas, exhibiciones, periodos, promociones]);

  return { derivados, cargando };
}

/**
 * Une lo que el servidor ya produjo con lo que el teléfono derivó, sin duplicar.
 *
 * **Cuando la fila del servidor existe, manda ella** (ADR-0012). El derivado solo
 * rellena el hueco temporal: si el motor dice `anulada` y el espejo dice que hay
 * hallazgo, gana el servidor. Sin esa regla escrita, cada pantalla desempata a su
 * manera.
 *
 * Un hallazgo duplicado no es un detalle estético: deja la verja de check-out
 * IMPOSIBLE de despejar, que es peor que no tenerla. Por eso la clave se lleva en
 * mapas anidados y no en un string con separador — un id puede contener el
 * separador, y ahí el duplicado vuelve por la puerta de atrás.
 */
export function unirHallazgos(
  servidor: readonly IncidenciaLocal[],
  derivados: readonly IncidenciaLocal[],
  atendidosSinSincronizar: readonly ClaveHallazgo[],
): IncidenciaLocal[] {
  const vistos = new Map<
    string | null,
    Map<string | null, Map<string | null, Set<string>>>
  >();

  const marcar = (c: ClaveHallazgo): boolean => {
    const porLev =
      vistos.get(c.levantamiento_id) ??
      new Map<string | null, Map<string | null, Set<string>>>();
    vistos.set(c.levantamiento_id, porLev);
    const porSku =
      porLev.get(c.sku_id) ?? new Map<string | null, Set<string>>();
    porLev.set(c.sku_id, porSku);
    const origenes = porSku.get(c.exhibicion_negociada_id) ?? new Set<string>();
    porSku.set(c.exhibicion_negociada_id, origenes);
    if (origenes.has(c.origen)) return false;
    origenes.add(c.origen);
    return true;
  };

  const atendidos = new Set<string>();
  for (const c of atendidosSinSincronizar) {
    atendidos.add(
      [c.levantamiento_id, c.sku_id, c.exhibicion_negociada_id, c.origen].join(
        "\u0000",
      ),
    );
  }
  const yaAtendido = (c: ClaveHallazgo) =>
    atendidos.has(
      [c.levantamiento_id, c.sku_id, c.exhibicion_negociada_id, c.origen].join(
        "\u0000",
      ),
    );

  // El servidor primero: es quien manda, y así el derivado nunca lo desplaza.
  const unidos: IncidenciaLocal[] = [];
  for (const i of servidor) {
    marcar(i);
    unidos.push({
      ...i,
      atendidaSinSincronizar: i.estado === "pendiente" && yaAtendido(i),
    });
  }
  for (const d of derivados) {
    if (!marcar(d)) continue;
    unidos.push({ ...d, atendidaSinSincronizar: yaAtendido(d) });
  }
  return unidos;
}

/** Cuántas quedan por atender. `no_resuelta` ya fue atendida: no cuenta. */
export function contarPendientes(
  incidencias: readonly IncidenciaLocal[],
): number {
  // Una atendida sin sincronizar NO cuenta: el mercaderista ya hizo su parte, y
  // seguir contándola dejaría la verja impasable hasta que hubiera señal — que
  // es exactamente la trampa que ADR-0012 existe para no construir.
  return incidencias.filter(
    (i) => i.estado === "pendiente" && !i.atendidaSinSincronizar,
  ).length;
}

export type GrupoDeMarca = {
  marcaId: string | null;
  marcaNombre: string;
  incidencias: IncidenciaLocal[];
};

/**
 * Agrupa por marca — "te sale marca A: incidencias; marca B: incidencia".
 *
 * Las pendientes primero dentro de cada grupo: es lo que el mercaderista tiene
 * que atender antes de salir. Los grupos se ordenan por nombre, y la marca sin
 * nombre —una incidencia que no cuelga de ninguna— cae al final en su propio
 * grupo en vez de mezclarse con otra.
 */
export function agruparPorMarca(
  incidencias: readonly IncidenciaLocal[],
): GrupoDeMarca[] {
  const grupos = new Map<string | null, GrupoDeMarca>();
  for (const incidencia of incidencias) {
    const entrada = grupos.get(incidencia.marca_id) ?? {
      marcaId: incidencia.marca_id,
      marcaNombre: incidencia.marca_nombre ?? "Sin marca",
      incidencias: [],
    };
    entrada.incidencias.push(incidencia);
    grupos.set(incidencia.marca_id, entrada);
  }

  for (const grupo of grupos.values()) {
    grupo.incidencias.sort((a, b) => {
      const pendiente = (i: IncidenciaLocal) =>
        i.estado === "pendiente" ? 0 : 1;
      return pendiente(a) - pendiente(b);
    });
  }

  return [...grupos.values()].sort((a, b) => {
    if (a.marcaId === null) return 1;
    if (b.marcaId === null) return -1;
    return a.marcaNombre.localeCompare(b.marcaNombre);
  });
}

/**
 * Qué dice la incidencia, con los números que el motor guardó.
 *
 * Mapa exhaustivo y no un `switch` con `default`: un origen nuevo tiene que
 * romper la compilación aquí, no caer en un texto genérico que nadie note. Los
 * números salen de `detalle`; no se re-derivan (para eso está el motor).
 */
const DESCRIPCION: Record<
  OrigenIncidencia,
  (d: ReturnType<typeof detalleIncidenciaSchema.parse>) => string
> = {
  quiebre: (d) =>
    d.stock_sistema != null
      ? `Quiebre: ${d.stock_sistema} en sistema y 0 en piso`
      : "Quiebre: sin stock en piso",
  diferencia_stock: (d) =>
    d.stock_sistema != null && d.stock_piso != null
      ? `Diferencia: ${d.stock_sistema} en sistema y ${d.stock_piso} en piso`
      : "Diferencia entre el stock del sistema y el de piso",
  desviacion_precio: (d) =>
    d.precio_registrado != null && d.precio_regular != null
      ? `Precio S/ ${d.precio_registrado} — el regular es S/ ${d.precio_regular}`
      : "El precio en tienda se desvía del regular",
  promo_no_comunicada: (d) =>
    d.precio_registrado != null
      ? `Promoción no comunicada: en tienda está a S/ ${d.precio_registrado}`
      : "Hay una promoción en tienda que no estaba comunicada",
  exhibicion_no_instalada: () => "La exhibición negociada no está instalada",
  incumplimiento_planograma: () => "La góndola no cumple el planograma",
};

export function describirIncidencia(
  origen: OrigenIncidencia,
  detalle: string | null,
): string {
  return DESCRIPCION[origen](
    detalleIncidenciaSchema.parse(leerDetalle(detalle)),
  );
}

/** El jsonb llega a SQLite como texto; un texto roto no puede tumbar la lista. */
function leerDetalle(detalle: string | null): unknown {
  if (!detalle) return {};
  try {
    return JSON.parse(detalle);
  } catch {
    return {};
  }
}

/** El texto que describe cada estado, para que el color no sea la única señal. */
export const ETIQUETA_ESTADO: Record<EstadoIncidencia, string> = {
  pendiente: "Pendiente",
  resuelta: "Resuelta",
  no_resuelta: "Atendida con observación",
  // No se pinta —`useIncidenciasDeVisita` la excluye— pero el mapa es exhaustivo
  // para que añadir un estado rompa la compilación en vez de caer en blanco.
  anulada: "Corregida antes de atenderla",
};

export type DatosResolucion = {
  /** La clave natural del hallazgo, no un id de incidencia. */
  hallazgo: IncidenciaLocal;
  tenantId: string;
  accionTomada: string;
  foto: FotoCapturada;
};

/** Los seis campos de la clave natural, tal como los espera la tabla. */
function claveDe(h: IncidenciaLocal, tenantId: string) {
  return [
    tenantId,
    h.visita_id,
    h.levantamiento_id,
    h.sku_id,
    h.exhibicion_negociada_id,
    h.origen,
  ];
}

/**
 * Deja UNA sola declaración por hallazgo en la réplica.
 *
 * `INSERT OR REPLACE` no sirve: la tabla local solo tiene `id` como clave —
 * PowerSync no crea índices únicos— así que con un uuid nuevo cada vez nunca
 * reemplaza nada. La segunda declaración se insertaría como fila aparte, y en el
 * servidor chocaría contra `atencion_hallazgo_uq` con un 23505 que el conector
 * clasifica como permanente y DESCARTA: el mercaderista cambia de opinión y su
 * cambio desaparece sin un mensaje.
 */
const BORRAR_PREVIA = `DELETE FROM atencion_hallazgo
   WHERE tenant_id = ? AND visita_id = ?
     AND levantamiento_id IS ? AND sku_id IS ?
     AND exhibicion_negociada_id IS ? AND origen = ?`;

/**
 * Resuelve una incidencia: la acción tomada y su foto de evidencia.
 *
 * La foto y el enlace se escriben en la MISMA transacción local. PowerSync
 * agrupa las operaciones por transacción de SQLite y el conector las sube en ese
 * orden, así que el PUT de la foto llega antes que el PATCH que la referencia.
 * Al revés, el servidor devolvería un `23503` que el conector clasifica como
 * permanente y descarta — perdiendo la resolución en silencio.
 */
export async function resolverIncidencia(d: DatosResolucion): Promise<void> {
  await encolarFoto(
    {
      foto: d.foto,
      tenantId: d.tenantId,
      visitaId: d.hallazgo.visita_id,
      levantamientoId: d.hallazgo.levantamiento_id,
      tipo: "resolucion_incidencia",
    },
    async (tx, fotoId) => {
      const clave = claveDe(d.hallazgo, d.tenantId);
      await tx.execute(BORRAR_PREVIA, clave);
      await tx.execute(
        `INSERT INTO atencion_hallazgo
           (id, tenant_id, visita_id, levantamiento_id, sku_id,
            exhibicion_negociada_id, origen, estado, accion_tomada,
            foto_resolucion_id, creado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'resuelta', ?, ?, ?)`,
        [
          Crypto.randomUUID(),
          ...clave,
          d.accionTomada,
          fotoId,
          new Date().toISOString(),
        ],
      );
    },
  );
}

/**
 * El mercaderista no pudo resolverla, y dice por qué.
 *
 * No desaparece de la lista: queda atendida con observación. El supervisor
 * necesita ver que se miró y por qué se quedó así, que es la mitad del valor de
 * la lista.
 */
export async function noPuedoResolver(d: {
  hallazgo: IncidenciaLocal;
  tenantId: string;
  motivo: string;
}): Promise<void> {
  const clave = claveDe(d.hallazgo, d.tenantId);
  await db.writeTransaction(async (tx) => {
    await tx.execute(BORRAR_PREVIA, clave);
    await tx.execute(
      `INSERT INTO atencion_hallazgo
         (id, tenant_id, visita_id, levantamiento_id, sku_id,
          exhibicion_negociada_id, origen, estado, motivo, creado_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'no_resuelta', ?, ?)`,
      [Crypto.randomUUID(), ...clave, d.motivo, new Date().toISOString()],
    );
  });
}

/** El resumen que la cabecera pinta desde cualquier módulo. */
export function useResumenIncidencias(visitaId: string) {
  const { incidencias, cargando, error } = useIncidenciasDeVisita(visitaId);
  const pendientes = useMemo(
    () => contarPendientes(incidencias),
    [incidencias],
  );
  return { incidencias, pendientes, cargando, error };
}
