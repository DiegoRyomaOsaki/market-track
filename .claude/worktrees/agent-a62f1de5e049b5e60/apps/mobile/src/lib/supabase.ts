import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import "react-native-url-polyfill/auto";

import { crearAlmacenSesion } from "./almacen-sesion";
import { env } from "./env";

/**
 * El cliente de Supabase del móvil.
 *
 * `detectSessionInUrl: false`: eso es cosa del navegador; en RN no hay URL que
 * inspeccionar y activarlo rompe el arranque.
 *
 * OJO con el alcance: este cliente es para AUTENTICAR y para ESCRIBIR (las
 * subidas pasan por PostgREST, y ahí la RLS sí manda). Los flujos de campo NO
 * leen de aquí: leen de la réplica local de PowerSync. Una llamada de red en el
 * check-in o en el levantamiento es un bug, aunque funcione en la oficina
 * (ADR-0001).
 */
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    storage: crearAlmacenSesion(SecureStore),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
