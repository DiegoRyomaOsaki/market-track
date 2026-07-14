// La config de la raíz ignora `packages/**` (flat config no cascadea), así que
// cada workspace trae la suya. Se reutiliza la de la raíz por ruta relativa, igual
// que hace packages/db: crear un `packages/eslint-config` con dos consumidores
// sería extraer antes de tiempo (la regla del proyecto es esperar al tercero).
import rootConfig from "../../eslint.config.mjs";

export default [...rootConfig];
