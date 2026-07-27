// El vocabulario del negocio. Web y móvil lo importan; nadie redefine estas
// formas por su cuenta.
//
// Dos reglas que sostienen el paquete:
//
//   Los ENUMS se derivan de la base (`Constants` de packages/db), nunca se
//   escriben a mano. Dos listas serían dos fuentes de verdad, y la de aquí se
//   quedaría vieja en silencio.
//
//   Los tipos de FILA vienen de `packages/db` (`Tables<'visita'>`). Aquí viven
//   los esquemas de VALIDACIÓN de las fronteras: lo que sube el móvil, lo que
//   entra por una Edge Function, lo que llega en un webhook. Esos payloads NO son
//   la fila: omiten los campos derivados y los que decide el servidor.

export * from "./ayuda-mercaderista";
export * from "./enums";
export * from "./env";
export * from "./schemas/levantamiento";
