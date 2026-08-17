// Sella `foto.verificada_at` tras comprobar contra R2 que el objeto EXISTE. Es
// la única escritora de esa columna: la app no puede (lo impide un trigger), y
// así el motor de puntaje tendrá una señal que el teléfono no fabrica.
//
// La invoca pg_cron (`app.barrer_fotos_sin_verificar`) cada pocos minutos con un
// secreto compartido en la cabecera — no un cliente con JWT (por eso
// `verify_jwt = false` en config.toml). Del cuerpo se confía lo mínimo: en modo
// `una`, solo el id (la fila se RE-LEE con service role); en modo `barrer`, un
// límite acotado por Zod y otra vez por la SQL.
//
// Qué certifica el sello y qué no: que hay un objeto bajo la key de la foto. NO
// mira el contenido. Y ninguna rama borra ni desactiva nada: 404 deja la fila
// sin sellar; 5xx/timeout la deja sin sellar y se reintenta después. Una caída
// de R2 nunca es evidencia de fraude (ADR-0003, "reconciliación").

import { igualesEnTiempoConstante } from "../_shared/secreto.ts";
import { clienteServicio, json } from "../_shared/supabase.ts";
import {
  cabezaDeObjeto,
  clienteR2,
  construirKeyFoto,
  leerConfigR2,
} from "../_shared/r2.ts";
import {
  type Decision,
  decidirVerificacion,
  LIMITE_BARRIDO_DEFECTO,
  peticionVerificacionSchema,
} from "../_shared/verificacion-foto.ts";

// Fail-closed las dos: sin secreto el endpoint estaría abierto a internet; sin
// config de R2 no hay nada que comprobar.
const SECRETO = Deno.env.get("FOTO_VERIFICACION_SECRET");
if (!SECRETO) {
  throw new Error(
    "FOTO_VERIFICACION_SECRET no configurado: la función no arranca (fail-closed)",
  );
}
const CONFIG_R2 = leerConfigR2(Deno.env.toObject());
const R2 = clienteR2(CONFIG_R2);

// Plazo por HEAD y plazo GLOBAL del barrido: cuando la operación se parte en
// tandas, el deadline cubre la operación entera — un plazo por tanda dentro de un
// bucle multiplica el peor caso en vez de acotarlo.
const HEAD_TIMEOUT_MS = 8_000;
const BARRIDO_TIMEOUT_MS = 25_000;
const CONCURRENCIA = 5;

type FotoPendiente = { id: string; tenant_id: string; visita_id: string };
type Sello = { foto_id: string; bytes: number | null };
type Resultado = { decision: Decision; bytes: number | null };

function mensajeDe(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

/** Un HEAD contra R2 y su veredicto. Lanza solo por bugs; red/timeout → reintentar. */
async function verificar(foto: FotoPendiente): Promise<Resultado> {
  const key = construirKeyFoto({
    tenantId: foto.tenant_id,
    visitaId: foto.visita_id,
    fotoId: foto.id,
  });
  try {
    const cabeza = await cabezaDeObjeto(R2, CONFIG_R2, key, HEAD_TIMEOUT_MS);
    return {
      decision: decidirVerificacion(cabeza.estado, cabeza.bytes),
      bytes: cabeza.bytes,
    };
  } catch (e) {
    console.error(
      JSON.stringify({
        evento: "foto_head_fallo",
        foto_id: foto.id,
        detalle: mensajeDe(e),
      }),
    );
    return { decision: "reintentar", bytes: null };
  }
}

async function sellar(sellos: Sello[]): Promise<number> {
  if (sellos.length === 0) return 0;
  const { data, error } = await clienteServicio()
    .rpc("sellar_fotos_verificadas", { p_sellos: sellos })
    .abortSignal(AbortSignal.timeout(HEAD_TIMEOUT_MS));
  if (error) throw new Error(`sellar_fotos_verificadas: ${error.message}`);
  return typeof data === "number" ? data : 0;
}

async function verificarUna(fotoId: string): Promise<Response> {
  const servicio = clienteServicio();
  const { data: foto, error } = await servicio
    .from("foto")
    .select("id, tenant_id, visita_id, subida_at, verificada_at")
    .eq("id", fotoId)
    .abortSignal(AbortSignal.timeout(HEAD_TIMEOUT_MS))
    .maybeSingle();
  if (error) {
    return json(500, {
      error: "no se pudo leer la foto",
      detalle: mensajeDe(error),
    });
  }
  if (!foto) return json(404, { error: "foto no encontrada" });
  if (foto.verificada_at) return json(200, { resultado: "ya_sellada" });
  if (!foto.subida_at) return json(200, { resultado: "sin_subir" });

  const r = await verificar(foto);
  if (r.decision === "sellar") {
    try {
      await sellar([{ foto_id: foto.id, bytes: r.bytes }]);
    } catch (e) {
      return json(500, { error: "no se pudo sellar", detalle: mensajeDe(e) });
    }
    return json(200, { resultado: "sellada", bytes: r.bytes });
  }
  if (r.decision === "no_encontrada") {
    console.warn(
      JSON.stringify({ evento: "foto_no_encontrada_en_r2", foto_id: foto.id }),
    );
    return json(200, { resultado: "no_encontrada" });
  }
  // `reintentar`: 502 para que quien llame sepa que no hubo veredicto.
  return json(502, { resultado: "reintentar" });
}

async function barrer(limite: number): Promise<Response> {
  const servicio = clienteServicio();
  // La RPC RECLAMA el lote (estampa el intento): dos barridos solapados no se
  // pisan y un 404 permanente no bloquea la cabeza de la cola.
  const { data, error } = await servicio
    .rpc("fotos_pendientes_de_verificacion", { p_limite: limite })
    .abortSignal(AbortSignal.timeout(HEAD_TIMEOUT_MS));
  if (error) {
    return json(500, {
      error: "no se pudo listar pendientes",
      detalle: mensajeDe(error),
    });
  }
  const pendientes = (data ?? []) as FotoPendiente[];

  const inicio = Date.now();
  const sellos: Sello[] = [];
  let noEncontradas = 0;
  let reintentables = 0;
  let procesadas = 0;
  let cortadoPorPlazo = false;

  // Tandas de CONCURRENCIA; al vencer el plazo global se deja de arrancar HEADs y
  // se sella lo acumulado — lo no procesado lo recoge el siguiente barrido.
  for (let i = 0; i < pendientes.length; i += CONCURRENCIA) {
    if (Date.now() - inicio > BARRIDO_TIMEOUT_MS) {
      cortadoPorPlazo = true;
      break;
    }
    const tanda = pendientes.slice(i, i + CONCURRENCIA);
    const resultados = await Promise.all(tanda.map(verificar));
    resultados.forEach((r, j) => {
      procesadas++;
      if (r.decision === "sellar")
        sellos.push({ foto_id: tanda[j]!.id, bytes: r.bytes });
      else if (r.decision === "no_encontrada") noEncontradas++;
      else reintentables++;
    });
  }

  let selladas = 0;
  try {
    selladas = await sellar(sellos);
  } catch (e) {
    return json(500, {
      error: "no se pudo sellar el lote",
      detalle: mensajeDe(e),
    });
  }

  const resumen = {
    evento: "fotos_barrido",
    procesadas,
    selladas,
    no_encontradas: noEncontradas,
    reintentables,
    cortado_por_plazo: cortadoPorPlazo,
  };
  // Procesar y no sellar NADA es la firma de "R2 no contesta o rotaron las
  // credenciales" — el fallo que de otro modo es mudo, porque nadie más mira
  // esta columna hasta que el motor la lea.
  if (procesadas > 0 && selladas === 0) console.error(JSON.stringify(resumen));
  else console.log(JSON.stringify(resumen));

  return json(200, {
    procesadas,
    selladas,
    no_encontradas: noEncontradas,
    reintentables,
    cortado_por_plazo: cortadoPorPlazo,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "método no permitido" });

  if (
    !igualesEnTiempoConstante(
      req.headers.get("x-webhook-secret") ?? "",
      SECRETO,
    )
  ) {
    return json(401, { error: "secreto inválido" });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json(400, { error: "cuerpo no es JSON válido" });
  }
  const parsed = peticionVerificacionSchema.safeParse(cuerpo);
  if (!parsed.success) {
    return json(400, {
      error: "payload inválido",
      detalles: parsed.error.issues,
    });
  }

  if (parsed.data.modo === "una") return verificarUna(parsed.data.foto_id);
  return barrer(parsed.data.limite ?? LIMITE_BARRIDO_DEFECTO);
});
