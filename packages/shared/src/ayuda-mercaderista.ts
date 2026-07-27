// La ayuda contextual de la app del mercaderista. VIAJA CON LA APP (empaquetada),
// nunca se descarga: se consulta en un sótano sin señal (ver CLAUDE.md). Por eso
// vive aquí, en shared, y no en una tabla de BD. El panel web tiene su propia
// ayuda en apps/web — son productos y públicos distintos.

export type ClaveAyuda =
  | "check_in"
  | "seleccion_marca"
  | "antes"
  | "quiebres"
  | "precios"
  | "exhibiciones"
  | "despues"
  | "check_out";

export type Ayuda = { titulo: string; cuerpo: string[] };

export const AYUDA_MERCADERISTA: Record<ClaveAyuda, Ayuda> = {
  check_in: {
    titulo: "Check-in",
    cuerpo: [
      "Marca tu entrada a la tienda. La app comprueba que estés dentro del radio de la tienda; si estás fuera, puedes continuar pero tu supervisor lo verá.",
      "La selfie es obligatoria: se toma en el momento, con la hora y las coordenadas grabadas en la foto. No se puede elegir de la galería.",
      "La hora oficial la pone el servidor cuando se sincroniza, no tu teléfono.",
    ],
  },
  seleccion_marca: {
    titulo: "Marcas a auditar",
    cuerpo: [
      "En cada tienda auditas todas las marcas de tu cliente que se venden ahí. Cada marca es un levantamiento aparte, en su propio pasillo.",
      "Toca una marca para empezar o continuar su levantamiento. Cuando todas queden completadas, podrás hacer el check-out.",
    ],
  },
  antes: {
    titulo: "Foto Antes y Share of Shelf",
    cuerpo: [
      "Toma la foto de la góndola tal como la encontraste, antes de trabajarla.",
      "Cuenta los frentes propios y los de cada competidor. El % de share se calcula solo. La foto por competidor y por SKU es opcional.",
      "Un frente es cada cara de producto visible al frente de la góndola.",
    ],
  },
  quiebres: {
    titulo: "Quiebres y diferencias",
    cuerpo: [
      "Registra por SKU el stock del sistema y el que hay en piso (góndola + trastienda).",
      "QUIEBRE (rojo): hay stock en el sistema pero cero en piso. DIFERENCIA (ámbar): hay stock en piso pero no cuadra con el sistema.",
      "Los avisos son en vivo, como guía; el dato definitivo lo calcula el sistema al sincronizar.",
    ],
  },
  precios: {
    titulo: "Precios",
    cuerpo: [
      "Digita el precio que ve el cliente en tienda para cada SKU.",
      "Si hay promoción, indícalo; y si la promoción está comunicada (con su cartel o material), márcalo también.",
      "No captures precios de la competencia: solo los de tu marca.",
    ],
  },
  exhibiciones: {
    titulo: "Exhibiciones",
    cuerpo: [
      "Revisa las exhibiciones negociadas: marca si están instaladas, cuántas unidades tienen y adjunta foto si puedes.",
      "Si conseguiste una exhibición nueva por tu cuenta, agrégala: su tipo, unidades, foto y si sigue vigente.",
    ],
  },
  despues: {
    titulo: "Foto Después",
    cuerpo: [
      "Toma la foto de la góndola ya trabajada. Es la prueba del antes y después de tu trabajo.",
    ],
  },
  check_out: {
    titulo: "Check-out",
    cuerpo: [
      "Cierra la visita. Antes de salir, la app valida que hayas auditado todas las marcas; si falta alguna, tócala para completarla o registra una contingencia con su motivo.",
      "No hace falta esperar a que suban las fotos: se envían solas cuando haya señal.",
      "Deja tu salida con GPS y, si quieres, una nota en la bitácora. Al salir arranca el cronómetro de traslado a la siguiente tienda.",
    ],
  },
};
