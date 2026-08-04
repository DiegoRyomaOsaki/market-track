import { Constants } from "@market-track/db";
import { z } from "zod";

// Los enums NO se escriben aquí: se derivan de la base de datos.
//
// `Constants` viene de `packages/db` y trae los enums de Postgres como arrays en
// tiempo de ejecución. `z.enum()` los acepta tal cual — sin un solo cast.
//
// Eso importa más de lo que parece. La alternativa sería escribir la lista otra
// vez a mano:
//
//   const rol = z.enum(["admin", "supervisor", "mercaderista", "cliente"]);  ← NO
//
// y entonces habría DOS fuentes de verdad. El día que una migración añada un rol,
// la lista de aquí seguiría diciendo que no existe, y `parse()` rechazaría en
// runtime un valor que la base considera perfectamente válido — un fallo mudo que
// solo aparece en producción, con el usuario nuevo delante.
//
// Derivándolos, un rol nuevo en una migración se propaga solo: `pnpm db:types` y
// listo. Y si alguien cambia el enum sin querer, el test de contrato de
// `packages/db` se pone rojo antes de llegar aquí.

export const rolUsuarioSchema = z.enum(Constants.public.Enums.rol_usuario);
export const estadoVisitaSchema = z.enum(Constants.public.Enums.estado_visita);
export const decisionRevisionSchema = z.enum(
  Constants.public.Enums.decision_revision,
);
export const estadoLevantamientoSchema = z.enum(
  Constants.public.Enums.estado_levantamiento,
);
export const estadoRuteroSchema = z.enum(Constants.public.Enums.estado_rutero);
export const estadoParadaSchema = z.enum(Constants.public.Enums.estado_parada);
export const pasoLevantamientoSchema = z.enum(
  Constants.public.Enums.paso_levantamiento,
);
export const tipoFotoSchema = z.enum(Constants.public.Enums.tipo_foto);
export const tipoExhibicionSchema = z.enum(
  Constants.public.Enums.tipo_exhibicion,
);
export const tipoAlertaSchema = z.enum(Constants.public.Enums.tipo_alerta);
export const severidadAlertaSchema = z.enum(
  Constants.public.Enums.severidad_alerta,
);
export const estadoAlertaSchema = z.enum(Constants.public.Enums.estado_alerta);
export const canalAlertaSchema = z.enum(Constants.public.Enums.canal_alerta);
export const canalOtpSchema = z.enum(Constants.public.Enums.canal_otp);
export const tipoTiendaSchema = z.enum(Constants.public.Enums.tipo_tienda);
export const estadoImportacionSchema = z.enum(
  Constants.public.Enums.estado_importacion,
);
// Los módulos (secciones) del portal cliente que el admin habilita por cliente
// (MAR-74). Es el contrato tipado que consumen el shell (MAR-54) y el toggle
// admin (MAR-81) sin redefinir la lista.
export const moduloPortalSchema = z.enum(Constants.public.Enums.modulo_portal);

export type RolUsuario = z.infer<typeof rolUsuarioSchema>;
export type EstadoVisita = z.infer<typeof estadoVisitaSchema>;
export type EstadoLevantamiento = z.infer<typeof estadoLevantamientoSchema>;
export type EstadoRutero = z.infer<typeof estadoRuteroSchema>;
export type EstadoParada = z.infer<typeof estadoParadaSchema>;
export type PasoLevantamiento = z.infer<typeof pasoLevantamientoSchema>;
export type TipoFoto = z.infer<typeof tipoFotoSchema>;
export type TipoExhibicion = z.infer<typeof tipoExhibicionSchema>;
export type TipoAlerta = z.infer<typeof tipoAlertaSchema>;
export type SeveridadAlerta = z.infer<typeof severidadAlertaSchema>;
export type EstadoAlerta = z.infer<typeof estadoAlertaSchema>;
export type CanalAlerta = z.infer<typeof canalAlertaSchema>;
export type CanalOtp = z.infer<typeof canalOtpSchema>;
export type TipoTienda = z.infer<typeof tipoTiendaSchema>;
export type EstadoImportacion = z.infer<typeof estadoImportacionSchema>;
export type ModuloPortal = z.infer<typeof moduloPortalSchema>;
