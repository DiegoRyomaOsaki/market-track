// La cola de fotos hacia R2 (ADR-0001 / ADR-0003).
//
// Es una cola SEPARADA de la del motor de sync: las fotos no viajan por
// PowerSync (son binarios grandes), van por una cola de disco propia hacia R2.
// Por eso una visita puede aparecer sincronizada (su registro subió) con sus
// fotos aún pendientes.
//
// Este módulo es la ESTRUCTURA y el contador (MAR-33). La subida real a R2 con
// URLs firmadas y reintentos es MAR-20/MAR-39: aquí la cola se llena (al capturar
// fotos, MAR-37) y se vacía (cuando MAR-39 las suba), y el indicador la lee.

export type FotoPendiente = {
  id: string;
  ruta: string; // ruta local del archivo en disco
  hash: string; // se calcula al capturar (integridad), no al subir
  encolada_at: string; // ISO
};

/** Almacenamiento del manifiesto; inyectable para poder probar sin disco. */
export type AlmacenManifiesto = {
  leer: () => Promise<string | null>;
  escribir: (contenido: string) => Promise<void>;
};

function parsear(contenido: string | null): FotoPendiente[] {
  if (!contenido) return [];
  try {
    const datos: unknown = JSON.parse(contenido);
    return Array.isArray(datos) ? (datos as FotoPendiente[]) : [];
  } catch {
    // Un manifiesto corrupto no debe tumbar la app: se trata como vacío. Peor
    // caso, una foto se re-encola; nunca se pierde el archivo, que está en disco.
    return [];
  }
}

type Escucha = (n: number) => void;

/**
 * La cola de fotos pendientes de subir. Un manifiesto en disco (la lista) + los
 * archivos aparte. Notifica a los suscriptores cuando cambia el número.
 */
export class ColaFotos {
  private escuchas = new Set<Escucha>();

  constructor(private readonly almacen: AlmacenManifiesto) {}

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
    const fotos = await this.manifiesto();
    // Idempotente por id: encolar dos veces la misma foto no la duplica.
    if (fotos.some((f) => f.id === foto.id)) return;
    await this.guardar([...fotos, foto]);
  }

  async marcarSubida(id: string): Promise<void> {
    const fotos = await this.manifiesto();
    await this.guardar(fotos.filter((f) => f.id !== id));
  }

  suscribir(cb: Escucha): () => void {
    this.escuchas.add(cb);
    return () => this.escuchas.delete(cb);
  }
}
