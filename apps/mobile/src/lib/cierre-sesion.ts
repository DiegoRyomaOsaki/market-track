import { Alert } from "react-native";

import { colaFotos } from "./cola-fotos-instancia";
import { mensajeDeError } from "./error";
import { contarPendientes } from "./powersync/estado";
import { olvidarDispositivo } from "./recordar-dispositivo";
import { supabase } from "./supabase";

// Cerrar sesión en el móvil, preguntando antes.
//
// Antes era un toque seco en el encabezado de "Mi día" —la pantalla que el
// mercaderista tiene abierta todo el día— que no miraba ninguna de las dos
// colas. Y lo que se pierde no se recupera reingresándolo: las fotos llevan
// watermark y coordenadas selladas en el instante de la captura, así que volver
// a la tienda mañana no reproduce esa evidencia.
//
// La regla de negocio es ADVERTIR, NUNCA BLOQUEAR. Bloquear con cola pendiente
// parece más protector y crea una cárcel: la cola tiene `requiere_atencion` —un
// fallo que no se arregla reintentando— así que una foto atascada dejaría a
// alguien sin poder cerrar sesión nunca, justo en los casos donde más falta hace
// (teléfono robado, alguien que deja la empresa).
//
// Todo vive aquí y no en la pantalla a propósito: `apps/mobile` no tiene tests
// de componente —`react-test-renderer` no soporta `act()` bajo React 19—, así
// que lo que entre en un `.tsx` nace sin cobertura. Desde aquí sí se puede
// probar que cancelar no deja efectos, que es el criterio que de verdad importa.

/** Cuánto se espera a que el servidor confirme el cierre antes de seguir. */
const DEADLINE_MS = 8_000;

export type ConteoDeSalida = {
  /** `null` = no se pudo contar. NUNCA 0: son cosas distintas. */
  registros: number | null;
  fotos: number | null;
};

export type MensajeDeSalida = { titulo: string; cuerpo: string };

export type Resultado = "cancelada" | "cerrada" | "reinicio_pendiente";

/** Los diálogos, inyectables: es la costura que hace probable el criterio 7. */
export type DialogosDeSalida = {
  confirmar: (mensaje: MensajeDeSalida) => Promise<boolean>;
  avisar: (mensaje: MensajeDeSalida) => void;
};

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * «3 registros y 5 fotos», o solo la mitad que tenga algo. Cadena vacía si no
 * hay nada pendiente.
 */
export function frasePendientes(registros: number, fotos: number): string {
  const partes: string[] = [];
  if (registros > 0) partes.push(plural(registros, "registro", "registros"));
  if (fotos > 0) partes.push(plural(fotos, "foto", "fotos"));
  return partes.join(" y ");
}

/**
 * Qué se le pregunta al mercaderista.
 *
 * Con la cola vacía se pregunta IGUAL, y esto contradice a propósito la letra
 * del criterio original («no molestar por nada»). El motivo es un hallazgo de la
 * verificación: volver a entrar exige contraseña y segundo factor CON RED, haya
 * cola o no. Un toque accidental a las nueve de la mañana en un sótano deja al
 * mercaderista fuera a media jornada aunque no pierda un solo byte — y ese daño
 * no depende de la cola. Sigue siendo corto: una frase y dos botones.
 */
export function mensajeDeSalida(
  conteo: ConteoDeSalida,
  hayConexion: boolean,
): MensajeDeSalida {
  const sinRed = hayConexion
    ? ""
    : " Ahora mismo no hay señal, así que no podrás volver a entrar hasta tenerla.";

  if (conteo.registros === null || conteo.fotos === null) {
    // Ni una palabra que suene a "no tienes nada": no se sabe, y decir 0 sería
    // afirmar lo que no se comprobó.
    return {
      titulo: "¿Cerrar sesión?",
      cuerpo:
        "No pudimos comprobar si te queda trabajo sin enviar. Si lo hay y otro mercaderista entra en este teléfono, ese trabajo se pierde." +
        sinRed,
    };
  }

  const frase = frasePendientes(conteo.registros, conteo.fotos);
  if (frase === "") {
    return {
      titulo: "¿Cerrar sesión?",
      cuerpo:
        "No te queda trabajo sin enviar. Para volver a entrar necesitarás tu contraseña y el código de verificación." +
        sinRed,
    };
  }

  return {
    titulo: "Te queda trabajo sin enviar",
    cuerpo:
      `Tienes ${frase} sin enviar. Si otro mercaderista entra en este teléfono antes de que vuelvas, ese trabajo se borra y no se recupera: las fotos llevan la hora y el lugar del momento en que las tomaste.` +
      sinRed,
  };
}

/**
 * Los dos conteos, leídos EN EL MOMENTO del toque.
 *
 * No se leen de los hooks del render: `useEstadoSync` solo recuenta dentro de
 * `statusChanged`, y ese evento no se emite al escribir en local. Un
 * mercaderista que lleva la mañana entera sin señal acumula registros sin que el
 * hook se entere, así que el valor del render diría «no tienes nada» justo en el
 * escenario que esta pantalla existe para proteger.
 *
 * Cada cuenta falla por su cuenta: que el manifiesto de fotos no se pueda leer
 * no debe borrar el número de registros, que sí se sabe.
 */
export async function leerConteoDeSalida(): Promise<ConteoDeSalida> {
  const [registros, fotos] = await Promise.all([
    contarPendientes().catch((e: unknown) => {
      console.warn(`[salir] no se pudo contar registros: ${mensajeDeError(e)}`);
      return null;
    }),
    colaFotos.contarPendientes().catch((e: unknown) => {
      console.warn(`[salir] no se pudo contar fotos: ${mensajeDeError(e)}`);
      return null;
    }),
  ]);
  return { registros, fotos };
}

/**
 * Los diálogos de verdad. `Alert` nativo y no un `Modal` propio: TalkBack y
 * VoiceOver lo anuncian entero al aparecer, atrapan el foco y lo devuelven al
 * salir — con un `Modal` habría que resolver todo eso a mano.
 */
export const dialogosAlert: DialogosDeSalida = {
  confirmar: ({ titulo, cuerpo }) =>
    new Promise<boolean>((resolver) => {
      Alert.alert(
        titulo,
        cuerpo,
        [
          {
            text: "Seguir trabajando",
            style: "cancel",
            onPress: () => resolver(false),
          },
          {
            text: "Cerrar sesión",
            style: "destructive",
            onPress: () => resolver(true),
          },
        ],
        {
          // En Android el diálogo se cierra tocando fuera o con el botón atrás
          // SIN invocar ningún `onPress`. Sin esto la promesa no se resolvería
          // nunca y "Salir" dejaría de funcionar para siempre — el guardarraíl
          // de reentrada de abajo se quedaría echado.
          cancelable: true,
          onDismiss: () => resolver(false),
        },
      );
    }),
  avisar: ({ titulo, cuerpo }) => Alert.alert(titulo, cuerpo),
};

/** Un cierre en curso: sin esto, dos toques encolan dos diálogos y dos salidas. */
let cerrando = false;

/**
 * Pregunta y, si se confirma, cierra la sesión.
 *
 * **`olvidarDispositivo()` va ANTES de `signOut()`, y se conserva en la salida
 * voluntaria.** No es un castigo ni la causa del encierro que se le atribuía: la
 * ventana de «recordar 30 días» solo se consulta al ARRANCAR la app cuando ya
 * hay sesión persistida, nunca al iniciar sesión, así que borrarla no hace más
 * difícil volver a entrar — lo que lo hace difícil es `signOut()`, porque el
 * login siempre pide contraseña y segundo factor con red.
 *
 * Lo que sí hace es cerrar el fallo parcial: si `signOut()` no consigue limpiar
 * la sesión local, el siguiente arranque encuentra sesión SIN ventana vigente y
 * la cierra él (`app/_layout.tsx`). Al revés —olvidar después— ese arranque
 * encontraría sesión y ventana viva, y entraría como si no se hubiera pulsado
 * nada.
 */
export async function cerrarSesion(
  io: DialogosDeSalida = dialogosAlert,
  hayConexion = true,
): Promise<Resultado> {
  if (cerrando) return "cancelada";
  cerrando = true;
  try {
    const conteo = await leerConteoDeSalida();
    const mensaje = mensajeDeSalida(conteo, hayConexion);

    if (!(await io.confirmar(mensaje))) return "cancelada";

    // La única traza de que ese trabajo existió, si acaba borrándose porque otro
    // mercaderista entra en el teléfono.
    console.warn(
      `[salir] confirmado registros=${conteo.registros ?? "?"} fotos=${conteo.fotos ?? "?"}`,
    );

    try {
      await olvidarDispositivo();
    } catch (e) {
      // Que falle el almacén cifrado no puede impedir la salida: se pierde el
      // guardarraíl del arranque, no el cierre.
      console.warn(
        `[salir] no se pudo olvidar el dispositivo: ${mensajeDeError(e)}`,
      );
    }

    // El `.catch` va sobre la promesa y no solo alrededor de la carrera: la
    // perdedora de un `Promise.race` no se espera nunca, así que un rechazo
    // tardío de `signOut` quedaría sin manejar.
    const cierre = supabase.auth.signOut().catch((e: unknown) => {
      console.error(`[salir] signOut: ${mensajeDeError(e)}`);
    });

    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        cierre,
        new Promise<never>((_, rechazar) => {
          temporizador = setTimeout(
            () => rechazar(new Error("timeout")),
            DEADLINE_MS,
          );
        }),
      ]);
    } catch (e) {
      console.error(`[salir] signOut: ${mensajeDeError(e)}`);
    } finally {
      // Sin esto el temporizador sigue vivo los 8 s aunque el cierre haya ido
      // bien: en un teléfono es un despertador de más por cada salida.
      if (temporizador !== undefined) clearTimeout(temporizador);
    }

    // Se comprueba el resultado, no se supone: auth-js borra la sesión local
    // incluso cuando la llamada de red falla, así que un error no significa que
    // el usuario siga dentro.
    const { data } = await supabase.auth.getSession();
    if (data.session === null) return "cerrada";

    io.avisar({
      titulo: "No se pudo cerrar del todo",
      cuerpo:
        "Cierra la app y vuelve a abrirla para terminar de salir. Tu trabajo sin enviar sigue guardado en este teléfono.",
    });
    return "reinicio_pendiente";
  } finally {
    cerrando = false;
  }
}
