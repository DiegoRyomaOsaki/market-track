import type { Metadata } from "next";

import { galeriaEvidenciaSchema } from "@market-track/shared";

import { Aviso } from "@/components/panel/tabla";
import { FiltroTipoFoto } from "@/components/portal/galeria/filtro-tipo-foto";
import { TiendaConEvidencia } from "@/components/portal/galeria/tienda-con-evidencia";
import { urlsFirmadas } from "@/lib/fotos-firmadas";
import { periodoDeFiltros } from "@/lib/portal/dashboard";
import { requerirModulo } from "@/lib/portal/estado-modulos";
import {
  leerFiltros,
  leerTipoFoto,
  type ParamsBusqueda,
} from "@/lib/portal/filtros";
import { idsFirmables, resumen } from "@/lib/portal/galeria";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Galería — Market Track" };

// Las URLs firmadas caducan en minutos: cachear esta página serviría enlaces
// muertos, y guardaría evidencia privada de un cliente en una caché compartida.
export const dynamic = "force-dynamic";

export default async function GaleriaPortalPage({
  searchParams,
}: {
  searchParams: Promise<ParamsBusqueda>;
}) {
  await requerirModulo("galeria");

  const params = await searchParams;
  const filtros = leerFiltros(params);
  const tipo = leerTipoFoto(params);
  const periodo = periodoDeFiltros(filtros, new Date());

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("galeria_evidencia", {
    p_desde: periodo.desde,
    p_hasta: periodo.hasta,
    // `undefined` y no `null`: los parámetros con `default` en la función se
    // tipan como opcionales, y omitirlos deja que Postgres aplique su default.
    p_cadena: filtros.cadena ?? undefined,
    p_tienda: filtros.tienda ?? undefined,
    p_tipo: tipo ?? undefined,
  });

  if (error) {
    console.error("[galeria] carga", error.message.slice(0, 200));
    return <Aviso>No pudimos cargar la evidencia. Vuelve a intentarlo.</Aviso>;
  }

  const parsed = galeriaEvidenciaSchema.safeParse(data);
  if (!parsed.success) {
    console.error(
      "[galeria] forma inesperada",
      parsed.error.message.slice(0, 200),
    );
    return <Aviso>La evidencia llegó con un formato que no reconocemos.</Aviso>;
  }
  const galeria = parsed.data;

  // Solo se firma lo que ya está en R2: mientras el binario siga en el teléfono
  // no hay objeto que firmar, y pedirlo devolvería un enlace a la nada.
  const { urls, degradado } = await urlsFirmadas(
    supabase,
    idsFirmables(galeria),
  );
  const cuenta = resumen(galeria);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-muted-foreground">
          {cuenta.tiendas === 0
            ? `Sin visitas entre ${periodo.desde} y ${periodo.hasta}.`
            : `${cuenta.visitas} visita(s) en ${cuenta.tiendas} tienda(s), entre ${periodo.desde} y ${periodo.hasta}.`}
        </p>
        <FiltroTipoFoto valor={tipo} />
      </div>

      {degradado ? (
        <Aviso>
          No pudimos preparar los enlaces de algunas fotos. Es un problema
          nuestro, no del trabajo en tienda: vuelve a intentarlo.
        </Aviso>
      ) : null}

      {galeria.truncado ? (
        <Aviso>
          Se muestran las visitas más recientes de {galeria.visitas_totales} en
          el periodo. Acota las fechas o la tienda para ver el resto.
        </Aviso>
      ) : null}

      {galeria.tiendas.length === 0 ? (
        <Aviso>
          No hay evidencia para estos filtros. Prueba a ampliar el rango de
          fechas.
        </Aviso>
      ) : (
        galeria.tiendas.map((t) => (
          <TiendaConEvidencia key={t.id} tienda={t} urls={urls} />
        ))
      )}
    </div>
  );
}
