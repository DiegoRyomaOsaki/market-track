import type { ColaFotos, FotoPendiente } from "./cola-fotos";
import { mensajeDeError } from "./error";

// El subidor: vacía la cola de disco hacia R2 con enlaces prefirmados.
//
// El binario va DIRECTO del teléfono a R2 y nunca entra en una operación del
// motor de sync (ADR-0003). Por el sync solo viaja la fila `foto`, que
// `encolarFoto` escribe en la réplica local antes de encolar el archivo.
//
// Todo lo que toca el mundo exterior entra por `DepsSubidor`, así que los tests
// corren sin red, sin disco y sin PowerSync.

export type ResultadoSubida = { estado: number };

export type DepsSubidor = {
  cola: ColaFotos;
  /**
   * Pide la URL PUT a la Edge Function `fotos-subida-firmada`. Devuelve solo la
   * URL: la caducidad no se lee, se descubre — un 403 en el PUT dispara el
   * refirmado, que es más fiable que fiarse de un reloj.
   */
  firmar: (visitaId: string, fotoId: string) => Promise<string>;
  /** Sube el archivo local a esa URL. Devuelve el status HTTP. */
  subirBinario: (url: string, ruta: string) => Promise<ResultadoSubida>;
  archivo: {
    existe: (ruta: string) => Promise<boolean>;
    borrar: (ruta: string) => Promise<void>;
  };
  replica: {
    /** ¿Ya está marcada como subida en la réplica? Atajo de idempotencia. */
    yaSubida: (fotoId: string) => Promise<boolean>;
    marcarSubida: (fotoId: string, subidaAt: string) => Promise<void>;
  };
  entorno: {
    conectado: () => boolean;
    /** Cuántos registros esperan en la cola del motor de sync. */
    registrosPendientes: () => Promise<number>;
    /** El mercaderista con sesión, o null. */
    usuarioId: () => string | null;
    ahora: () => number;
  };
};

/** Android de gama media y red móvil: dos subidas a la vez es el techo sensato. */
const CONCURRENCIA = 2;

/**
 * Plazo de cada llamada de red. NO es un lujo: `arrancar()` es single-flight, así
 * que una promesa que nunca se resuelve —radio en ahorro de energía, socket que
 * deja de emitir sin cerrarse— dejaría `enCurso` fijado y **la cola entera parada
 * el resto del turno**, sin que el botón de reintento ni los disparadores
 * automáticos pudieran destrabarla. El uploader nativo no garantiza un tope de
 * duración total, así que el reloj lo pone la aplicación.
 *
 * Generoso a propósito: una foto de 300 KB por 3G en un sótano tarda.
 */
const PLAZO_RED_MS = 90_000;

/** Corre la promesa contra un reloj. Al vencer, se trata como fallo transitorio. */
function conPlazo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let cancelar: ReturnType<typeof setTimeout>;
  const vencido = new Promise<never>((_, rechazar) => {
    cancelar = setTimeout(
      () => rechazar(new Error("plazo de red agotado")),
      ms,
    );
  });
  vencido.catch(() => undefined);
  return Promise.race([promesa, vencido]).finally(() => clearTimeout(cancelar));
}

/** A partir de aquí la foto se marca para que el usuario la mire; NO se abandona. */
const INTENTOS_ANTES_DE_AVISAR = 8;

const ESPERAS_MS = [5_000, 15_000, 45_000, 120_000, 300_000, 900_000];

/** Cuánto esperar cuando lo que bloquea es la cola de registros, no un fallo. */
const ESPERA_TRAS_REGISTROS_MS = 15_000;

/**
 * Cuánto esperar tras `intentos` fallos. Crece y tiene tope, con un margen
 * aleatorio para que treinta fotos que fallaron a la vez no vuelvan a la vez.
 */
export function esperaDeReintento(
  intentos: number,
  aleatorio = Math.random(),
): number {
  const base = ESPERAS_MS[Math.min(intentos, ESPERAS_MS.length - 1)] ?? 5_000;
  const jitter = 0.8 + aleatorio * 0.4;
  return Math.round(base * jitter);
}

/** ¿Toca ya reintentar esta foto? */
function tocaReintentar(foto: FotoPendiente, ahora: number): boolean {
  if (!foto.proximo_intento_at) return true;
  return new Date(foto.proximo_intento_at).getTime() <= ahora;
}

/**
 * ¿Reintentar este fallo es inútil?
 *
 * Solo el 400: es un payload que la función rechaza, y no mejora insistiendo.
 * 401 y 403 NO lo son — el token se refresca, y un 403 del firmado suele ser que
 * la `visita` todavía no llegó al servidor.
 *
 * "Inútil reintentar" tampoco significa descartar: se marca para que alguien lo
 * mire, pero el archivo no se borra jamás por un fallo. Solo el éxito borra.
 */
export function noMejoraReintentando(estado: number): boolean {
  return estado === 400;
}

/** El error que lanza `firmar` cuando la función responde con un status. */
export class ErrorFirmado extends Error {
  constructor(readonly estado: number) {
    super(`firmado rechazado con ${estado}`);
    this.name = "ErrorFirmado";
  }
}

export class SubidorFotos {
  private enCurso: Promise<void> | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: DepsSubidor) {}

  /**
   * Lanza una pasada. Es single-flight: cuatro disparadores a la vez (recuperar
   * conexión, volver al primer plano, encolar, el botón) son una sola pasada.
   */
  arrancar(): Promise<void> {
    this.enCurso ??= this.pasada().finally(() => {
      this.enCurso = null;
    });
    return this.enCurso;
  }

  /** Suelta el temporizador pendiente. Para el cierre de sesión y los tests. */
  detener(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = null;
  }

  private async pasada(): Promise<void> {
    const { cola, entorno } = this.deps;

    // Sin señal no se toca la red: ni una llamada, ni un reintento en bucle.
    if (!entorno.conectado()) return;

    const usuario = entorno.usuarioId();
    if (!usuario) return;

    // La `visita` tiene que existir en Postgres antes de pedir la firma: la Edge
    // Function la lee bajo la RLS del que llama y, si aún está en la cola CRUD del
    // teléfono, responde 403. Al recuperar señal los dos canales arrancan a la
    // vez, así que sin esta puerta el primer intento de cada foto se quema
    // siempre. El indicador de la pantalla lo explica en vez de callarlo.
    if ((await entorno.registrosPendientes()) > 0) {
      // Se reprograma en vez de salir en seco: depender solo de que llegue otro
      // `statusChanged` deja la cola parada si ese evento no vuelve a dispararse.
      this.programarEn(ESPERA_TRAS_REGISTROS_MS);
      return;
    }

    const ahora = entorno.ahora();
    const pendientes = (await cola.listarPendientes()).filter(
      (f) => f.mercaderista_id === usuario && tocaReintentar(f, ahora),
    );
    if (pendientes.length === 0) return;

    let siguiente = 0;
    const trabajador = async (): Promise<void> => {
      while (siguiente < pendientes.length) {
        const foto = pendientes[siguiente++];
        if (!foto) return;
        await this.procesar(foto);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCIA, pendientes.length) }, () =>
        trabajador(),
      ),
    );

    await this.programarSiguiente();
  }

  /** Arma el único temporizador de la cola dentro de `ms`. */
  private programarEn(ms: number): void {
    this.detener();
    this.temporizador = setTimeout(() => void this.arrancar(), ms);
  }

  /** Un solo temporizador para toda la cola, al vencimiento más cercano. */
  private async programarSiguiente(): Promise<void> {
    this.detener();
    const restantes = await this.deps.cola.listarPendientes();
    if (restantes.length === 0) return;

    const ahora = this.deps.entorno.ahora();
    const proximos = restantes
      .map((f) =>
        f.proximo_intento_at ? new Date(f.proximo_intento_at).getTime() : ahora,
      )
      .filter((t) => t > ahora);
    if (proximos.length === 0) return;

    this.programarEn(Math.max(1_000, Math.min(...proximos) - ahora));
  }

  private async procesar(foto: FotoPendiente): Promise<void> {
    const { cola, archivo, replica, entorno } = this.deps;

    // Si el proceso murió entre el PUT y el borrado, la fila ya está marcada:
    // no se vuelve a subir, solo se limpia. Es el atajo de idempotencia.
    if (await replica.yaSubida(foto.id)) {
      await this.limpiar(foto);
      return;
    }

    if (!(await archivo.existe(foto.ruta))) {
      // Sin binario no hay nada que subir. Se saca de la cola pero la fila `foto`
      // se queda SIN `subida_at`: el panel la seguirá contando como pendiente,
      // que es la verdad.
      console.warn(
        `Foto ${foto.id}: el archivo local ya no existe, se descarta`,
      );
      await cola.marcarSubida(foto.id);
      return;
    }

    try {
      const url = await conPlazo(
        this.deps.firmar(foto.visita_id, foto.id),
        PLAZO_RED_MS,
      );
      let subida = await conPlazo(
        this.deps.subirBinario(url, foto.ruta),
        PLAZO_RED_MS,
      );

      // El enlace caduca a los 15 min; una subida lenta en 3G puede pasarse. Se
      // pide otro y se reintenta una vez dentro del mismo intento, en vez de
      // gastar un ciclo de espera entero.
      if (subida.estado === 403) {
        const otra = await conPlazo(
          this.deps.firmar(foto.visita_id, foto.id),
          PLAZO_RED_MS,
        );
        subida = await conPlazo(
          this.deps.subirBinario(otra, foto.ruta),
          PLAZO_RED_MS,
        );
      }

      if (subida.estado >= 200 && subida.estado < 300) {
        // El orden importa: primero se marca, luego se borra. Al revés, morir en
        // medio dejaría el binario en R2 sin nadie que lo sepa.
        await replica.marcarSubida(
          foto.id,
          new Date(entorno.ahora()).toISOString(),
        );
        await this.limpiar(foto);
        return;
      }

      await this.fallo(
        foto,
        noMejoraReintentando(subida.estado),
        `PUT ${subida.estado}`,
      );
      return;
    } catch (e) {
      // Cualquier otro fallo (red, plazo agotado) es transitorio: se reintenta.
      const definitivo =
        e instanceof ErrorFirmado && noMejoraReintentando(e.estado);
      await this.fallo(foto, definitivo, mensajeDeError(e));
      return;
    }
  }

  private async limpiar(foto: FotoPendiente): Promise<void> {
    try {
      await this.deps.archivo.borrar(foto.ruta);
    } catch (e) {
      // Que no se pueda borrar el archivo no invalida la subida: la evidencia ya
      // está en R2. Se registra y se sigue; queda un huérfano, no una pérdida.
      console.warn(
        `Foto ${foto.id}: no se pudo borrar el archivo — ${mensajeDeError(e)}`,
      );
    }
    await this.deps.cola.marcarSubida(foto.id);
  }

  private async fallo(
    foto: FotoPendiente,
    definitivo: boolean,
    detalle: string,
  ): Promise<void> {
    const intentos = foto.intentos + 1;
    const espera = esperaDeReintento(intentos);
    await this.deps.cola.marcarIntento(foto.id, {
      proximoIntentoAt: new Date(
        this.deps.entorno.ahora() + espera,
      ).toISOString(),
      // Lo definitivo se marca a la primera; lo transitorio, tras insistir.
      requiereAtencion: definitivo || intentos >= INTENTOS_ANTES_DE_AVISAR,
    });
    console.warn(
      `Foto ${foto.id}: fallo ${definitivo ? "definitivo" : "transitorio"} — ${detalle}`,
    );
  }
}
