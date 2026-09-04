import type {
  DetalleAlerta,
  EstadoAlerta,
  SeveridadAlerta,
  TipoAlerta,
} from "@market-track/shared";
import type { PayloadAlerta } from "@market-track/shared";
import { ESTADOS_ALERTA, PAYLOAD_ALERTA } from "@market-track/shared";

// Cómo se lee una alerta en pantalla: su nombre, su tono, y qué evidencia tiene
// que enseñar cada tipo.
//
// Fuera de la UI porque lo comparten el feed del dashboard, la bandeja y el
// detalle. Con una copia por pantalla, el día que "diferencia_stock" cambie de
// nombre solo cambiaría en una.

/** El nombre de cada tipo. Exhaustivo: si el enum crece, deja de compilar. */
export const ETIQUETA_TIPO_ALERTA: Record<TipoAlerta, string> = {
  quiebre: "Quiebre de stock",
  diferencia_stock: "Diferencia de stock",
  desviacion_precio: "Desviación de precio",
  promo_no_activa: "Promoción no activa",
  exhibicion_incompleta: "Exhibición incompleta",
  contingencia: "Contingencia",
  // De staff: el portal del cliente-marca nunca la recibe (lo impiden la política
  // `alerta_usuario_lee_su_tenant` y el emisor del feed en vivo). Está aquí porque
  // el mapa es exhaustivo por diseño, y porque el día que exista una bandeja de
  // staff la leerá de aquí.
  verificacion_fotos: "Verificación de fotos pendiente",
};

export const ETIQUETA_SEVERIDAD: Record<SeveridadAlerta, string> = {
  critica: "Crítica",
  alta: "Alta",
  info: "Informativa",
};

export const ETIQUETA_ESTADO: Record<EstadoAlerta, string> = {
  nueva: "Nueva",
  vista: "Vista",
  resuelta: "Resuelta",
  // La escribe el motor, no una persona: el hallazgo dejó de existir porque el
  // mercaderista corrigió el dato en el punto de venta. No es lo mismo que
  // "resuelta", que significa que alguien de la marca la gestionó.
  anulada: "Corregida en tienda",
};

// Los tonos salen de los tokens del tema, nunca de un color crudo. El texto de la
// pastilla lleva SIEMPRE la etiqueta: el color solo acompaña, porque el color solo
// no comunica nada a quien no lo distingue (WCAG 1.4.1).
export const ESTILO_SEVERIDAD: Record<SeveridadAlerta, string> = {
  critica: "bg-alerta-suave text-alerta-texto",
  alta: "bg-en-curso-suave text-en-curso-texto",
  info: "bg-muted text-muted-foreground",
};

export const ESTILO_ESTADO: Record<EstadoAlerta, string> = {
  nueva: "bg-alerta-suave text-alerta-texto",
  vista: "bg-en-curso-suave text-en-curso-texto",
  resuelta: "bg-completado-suave text-completado-texto",
  // Apagada: ya no pide nada de nadie. El texto de la pastilla la distingue de
  // "resuelta"; el color solo acompaña (WCAG 1.4.1).
  anulada: "bg-muted text-muted-foreground",
};

/** Una línea del cuadro de evidencia: qué dato es y cuánto vale. */
export type FilaEvidencia = { etiqueta: string; valor: string };

const SOLES = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
});

function numero(v: number | null): string {
  return v === null ? "—" : String(v);
}

/**
 * Cómo se lee la evidencia de cada tipo. Un mapa y no un `switch`: si el enum
 * crece, falta una clave y deja de compilar — con un `default` el tipo nuevo
 * llegaría a producción sin que nadie lo hubiera escrito.
 */
const EVIDENCIA: {
  [K in TipoAlerta]: (p: PayloadAlerta[K]) => FilaEvidencia[];
} = {
  quiebre: (p) => [
    { etiqueta: "Stock en sistema", valor: numero(p.stock_sistema) },
    { etiqueta: "Stock en piso", valor: numero(p.stock_piso) },
  ],
  diferencia_stock: (p) => [
    { etiqueta: "Stock en sistema", valor: numero(p.stock_sistema) },
    { etiqueta: "Stock en piso", valor: numero(p.stock_piso) },
    {
      etiqueta: "Diferencia",
      valor: p.delta === null ? "—" : `${p.delta > 0 ? "+" : ""}${p.delta}`,
    },
  ],
  desviacion_precio: (p) => [
    { etiqueta: "Precio esperado", valor: SOLES.format(p.precio_regular) },
    { etiqueta: "Precio registrado", valor: SOLES.format(p.precio_registrado) },
    {
      etiqueta: "Motivo",
      valor:
        p.motivo === "sobreprecio"
          ? "Por encima del precio regular"
          : "Por debajo del regular sin promoción que lo justifique",
    },
  ],
  promo_no_activa: (p) => [
    { etiqueta: "Precio esperado", valor: SOLES.format(p.precio_regular) },
    { etiqueta: "Precio registrado", valor: SOLES.format(p.precio_registrado) },
  ],
  contingencia: (p) => [
    { etiqueta: "Paso omitido", valor: p.paso },
    { etiqueta: "Motivo", valor: p.motivo },
  ],
  exhibicion_incompleta: (p) => [
    { etiqueta: "Unidades instaladas", valor: numero(p.unidades) },
  ],
  verificacion_fotos: (p) => [
    { etiqueta: "Fotos subidas", valor: String(p.fotos_subidas) },
    { etiqueta: "Con sello del servidor", valor: String(p.fotos_verificadas) },
    { etiqueta: "Sin verificar", valor: `${p.pct_sin_verificar}%` },
    { etiqueta: "Umbral configurado", valor: `${p.umbral_pct}%` },
  ],
};

/**
 * Una fecha simple (`YYYY-MM-DD`) tal como se escribe, sin correrla un día.
 *
 * En UTC a propósito: `new Date("2026-01-01")` es medianoche UTC, y formatearla
 * en la zona de Lima —cinco horas por detrás— la enseñaría como 31 de
 * diciembre. Es la misma trampa que ya evita el gráfico de Perfect Store.
 */
const FORMATO_FECHA = new Intl.DateTimeFormat("es-PE", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function fecha(iso: string): string {
  return FORMATO_FECHA.format(new Date(iso));
}

/**
 * Desde cuándo rige el precio esperado, y hasta cuándo si ya se cerró.
 *
 * Sin esto, un precio que cambió en agosto y una alerta de julio se leen como
 * una contradicción. La ventana viene resuelta a la fecha de la VISITA, no a la
 * de hoy: es la que el motor usó para decidir.
 *
 * Devuelve null cuando no hay ventana que enseñar. Quien decide que una alerta
 * no habla de precio es `detalle_alerta`, que solo resuelve la ventana para los
 * tipos de precio: el payload de un quiebre también trae `sku_id`, y sin ese
 * filtro esto pintaría "ese precio regía desde…" en una pantalla sin ningún
 * precio.
 */
export function filaDeVigencia(
  desde: string | null,
  hasta: string | null,
): { etiqueta: string; valor: string } | null {
  if (desde === null) return null;
  return {
    etiqueta: "Ese precio regía",
    valor:
      hasta === null
        ? `desde el ${fecha(desde)}`
        : `del ${fecha(desde)} al ${fecha(hasta)}`,
  };
}

/**
 * La evidencia de una alerta, ya legible.
 *
 * El payload se valida contra el schema de SU tipo antes de leerlo: viene de un
 * `jsonb` sin forma declarada en la base, así que confiar en él es confiar en que
 * ninguna migración del motor lo haya cambiado. Si no encaja, se dice — el resto
 * de la pantalla (tienda, fecha, tipo) sigue siendo válido y útil.
 */
export function filasDeEvidencia(
  tipo: TipoAlerta,
  payload: unknown,
): FilaEvidencia[] {
  const parsed = PAYLOAD_ALERTA[tipo].safeParse(payload);
  if (!parsed.success) {
    return [
      {
        etiqueta: "Detalle",
        valor: "No pudimos leer los datos de esta alerta.",
      },
    ];
  }

  // El schema y el pintor se indexan con la MISMA clave, así que el payload
  // encaja con su pintor. TypeScript no correlaciona dos índices por una clave
  // genérica, y esa es toda la razón del cast.
  const pintar = EVIDENCIA[tipo] as (p: unknown) => FilaEvidencia[];
  return pintar(parsed.data);
}

/**
 * A qué estados se puede mover una alerta, con el verbo que le toca a cada uno.
 *
 * Se ofrecen todos menos el actual, reabrir incluido: la base permite cualquier
 * transición y no hay auditoría, así que un "resuelta" por error tiene que poder
 * deshacerse. Una regla monótona impuesta solo aquí sería una convención
 * disfrazada de garantía — quien llame a PostgREST directamente se la salta.
 *
 * `anulada` es la excepción, y no por monotonía: es el estado que escribe el
 * MOTOR cuando el hallazgo deja de existir. Ofrecerlo como botón dejaría que una
 * persona afirmara "esto se corrigió en tienda" sin que nadie lo haya corregido.
 * Desde `anulada` sí se sale: si el supervisor la quiere de vuelta en su bandeja,
 * la reabre.
 */
export function accionesDeEstado(
  actual: EstadoAlerta,
): { estado: EstadoAlerta; verbo: string }[] {
  const VERBO: Record<EstadoAlerta, string> = {
    nueva: "Reabrir",
    vista: "Marcar vista",
    resuelta: "Marcar resuelta",
    anulada: "Corregida en tienda",
  };
  return ESTADOS_ALERTA.filter((e) => e !== actual && e !== "anulada").map(
    (estado) => ({ estado, verbo: VERBO[estado] }),
  );
}

/** El rótulo de la foto: de qué es exactamente, sin insinuar de más. */
export function rotuloDeFoto(alerta: DetalleAlerta): string {
  if (alerta.foto === null) return "";
  return alerta.foto.del_hallazgo
    ? "Foto del hallazgo"
    : "Foto del paso en esa visita — no necesariamente de este producto";
}
