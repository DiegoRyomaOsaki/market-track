import { z } from "zod";

// La cola de fotos hacia R2 (ADR-0001 / ADR-0003).
//
// Es una cola SEPARADA de la del motor de sync: las fotos no viajan por
// PowerSync (son binarios grandes), van por una cola de disco propia hacia R2.
// Por eso una visita puede aparecer sincronizada (su registro subió) con sus
// fotos aún pendientes.
//
// Este módulo es el MANIFIESTO: qué falta por subir y cuántos intentos lleva
// cada una. Quién lo vacía es `subidor-fotos.ts`; quién lo llena, `encolarFoto`.

/** `z.guid()`, no `z.uuid()`: el estricto exige bits de versión que Postgres no impone. */
const uuid = z.guid();

export const fotoPendienteSchema = z.object({
  id: uuid,
  /** Ruta local del archivo, DERIVADA del id (ver `encolarFoto`). */
  ruta: z.string().min(1),
  /** Se calcula al capturar (integridad), nunca al subir. */
  hash: z.string().min(1),
  /** La visita a la que pertenece: la exige el firmado de subida. */
  visita_id: uuid,
  /** De quién es. Un cambio de usuario en el mismo teléfono no debe subir fotos ajenas. */
  mercaderista_id: uuid,
  encolada_at: z.iso.datetime({ offset: true }),
  /** Cuántas veces se ha intentado subir. Persistido: sobrevive a que maten la app. */
  intentos: z.number().int().min(0).default(0),
  /** Cuándo se puede volver a intentar (espera creciente). */
  proximo_intento_at: z.iso.datetime({ offset: true }).nullish(),
  /** Un fallo que no se arregla reintentando; se muestra, no se descarta. */
  requiere_atencion: z.boolean().default(false),
});

export type FotoPendiente = z.infer<typeof fotoPendienteSchema>;

/** Almacenamiento del manifiesto; inyectable para poder probar sin disco. */
export type AlmacenManifiesto = {
  leer: () => Promise<string | null>;
  escribir: (contenido: string) => Promise<void>;
};

/**
 * Parsea el manifiesto descartando lo que no encaje, entrada por entrada.
 *
 * Se valida cada una y no solo la forma del array porque una entrada escrita por
 * una versión anterior de la app (sin `visita_id`) haría fallar su firmado para
 * siempre. Descartarla pierde el enlace, no el archivo: la reconciliación lo
 * vuelve a encontrar por su ruta derivada del id.
 */
function parsear(contenido: string | null): FotoPendiente[] {
  if (!contenido) return [];
  let datos: unknown;
  try {
    datos = JSON.parse(contenido);
  } catch {
    // Un manifiesto truncado (corte de batería a mitad de escritura) no debe
    // tumbar la app. Se trata como vacío y la reconciliación lo reconstruye.
    console.warn(
      "Manifiesto de fotos ilegible: se reconstruirá desde la réplica",
    );
    return [];
  }
  if (!Array.isArray(datos)) return [];

  const validas: FotoPendiente[] = [];
  let descartadas = 0;
  for (const cruda of datos) {
    const r = fotoPendienteSchema.safeParse(cruda);
    if (r.success) validas.push(r.data);
    else descartadas += 1;
  }
  if (descartadas > 0) {
    console.warn(
      `Manifiesto de fotos: ${descartadas} entrada(s) con forma inválida`,
    );
  }
  return validas;
}

type Escucha = (n: number) => void;

/**
 * La cola de fotos pendientes de subir. Un manifiesto en disco (la lista) + los
 * archivos aparte. Notifica a los suscriptores cuando cambia el número.
 *
 * Todas las mutaciones se serializan: son leer-modificar-escribir, y el subidor
 * (concurrencia 2) escribe a la vez que un paso del wizard encola. Sin la cola de
 * promesas, una actualización perdida deja un archivo huérfano o resucita una
 * foto ya subida.
 */
export class ColaFotos {
  private escuchas = new Set<Escucha>();
  private ultima: Promise<unknown> = Promise.resolve();

  constructor(private readonly almacen: AlmacenManifiesto) {}

  /** Encadena la operación tras la anterior, pase lo que pase con aquella. */
  private enSerie<T>(op: () => Promise<T>): Promise<T> {
    const siguiente = this.ultima.then(op, op);
    // La cadena no debe romperse porque una operación falle.
    this.ultima = siguiente.catch(() => undefined);
    return siguiente;
  }

  private async manifiesto(): Promise<FotoPendiente[]> {
    return parsear(await this.almacen.leer());
  }

  private async guardar(fotos: FotoPendiente[]): Promise<void> {
    await this.almacen.escribir(JSON.stringify(fotos));
    for (const cb of this.escuchas) cb(fotos.length);
  }

  async contarPendientes(): Promise<number> {
    return (await this.manifiesto()).length;
  }

  /** Las fotos pendientes de subir, para la pantalla de sincronización. */
  async listarPendientes(): Promise<FotoPendiente[]> {
    return this.manifiesto();
  }

  async encolar(foto: FotoPendiente): Promise<void> {
    return this.enSerie(async () => {
      const fotos = await this.manifiesto();
      // Idempotente por id: encolar dos veces la misma foto no la duplica.
      if (fotos.some((f) => f.id === foto.id)) return;
      await this.guardar([...fotos, foto]);
    });
  }

  async marcarSubida(id: string): Promise<void> {
    return this.enSerie(async () => {
      const fotos = await this.manifiesto();
      await this.guardar(fotos.filter((f) => f.id !== id));
    });
  }

  /** Anota un intento fallido: cuándo reintentar y si ya necesita una mirada. */
  async marcarIntento(
    id: string,
    cambios: { proximoIntentoAt: string; requiereAtencion?: boolean },
  ): Promise<void> {
    return this.enSerie(async () => {
      const fotos = await this.manifiesto();
      await this.guardar(
        fotos.map((f) =>
          f.id === id
            ? {
                ...f,
                intentos: f.intentos + 1,
                proximo_intento_at: cambios.proximoIntentoAt,
                requiere_atencion:
                  cambios.requiereAtencion ?? f.requiere_atencion,
              }
            : f,
        ),
      );
    });
  }

  /** Vuelve a poner todo elegible ya: el botón "Reintentar ahora". */
  async reintentarTodas(): Promise<void> {
    return this.enSerie(async () => {
      const fotos = await this.manifiesto();
      await this.guardar(
        fotos.map((f) => ({ ...f, proximo_intento_at: null })),
      );
    });
  }

  suscribir(cb: Escucha): () => void {
    this.escuchas.add(cb);
    return () => this.escuchas.delete(cb);
  }
}
