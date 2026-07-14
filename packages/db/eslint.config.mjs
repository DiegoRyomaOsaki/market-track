// La config de la raíz ignora `packages/**` a propósito (flat config no
// cascadea), así que cada workspace trae la suya. Aquí se reutiliza la de la raíz
// por ruta relativa en vez de crear un `packages/eslint-config`: este sería el
// PRIMER consumidor, y la regla del proyecto es extraer al tercero.
import rootConfig from "../../eslint.config.mjs";

export default [
  ...rootConfig,
  {
    // El archivo generado no se lintea. `no-redundant-type-constituents` salta en
    // el helper `CompositeTypes` mientras no haya tipos compuestos en el esquema,
    // y no hay forma de arreglarlo sin editar a mano un archivo que se regenera
    // en cada migración. Quien lo revisa es `tsc`, que sí lo incluye.
    ignores: ["src/database.types.ts"],
  },
];
