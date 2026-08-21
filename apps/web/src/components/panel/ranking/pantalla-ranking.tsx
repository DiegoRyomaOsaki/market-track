import Link from "next/link";

import { botonSecundario } from "@/components/panel/estilos";
import { Pestanas } from "@/components/panel/pestanas";
import { Aviso } from "@/components/panel/tabla";
import { PERIODOS_PUNTAJE, type PeriodoPuntaje } from "@market-track/shared";
import { diaEnLima } from "@/lib/fecha-lima";
import { tenantActivo } from "@/lib/panel/tenant-activo";
import { datosDeRanking } from "@/lib/ranking/datos";
import {
  esFechaISO,
  etiquetaDePeriodo,
  periodoAnterior,
  periodoSiguiente,
} from "@/lib/ranking/ranking";

import { BotonRecalcular } from "./boton-recalcular";
import { TablaRanking } from "./tabla-ranking";

// El ranking completo del plan de lealtad, compartido por admin y supervisor.
//
// Quién ve a quién NO se decide aquí: la RPC le devuelve al supervisor solo su
// equipo, con las posiciones del cliente entero. La pantalla pinta lo que
// llega.

const ETIQUETA_TIPO: Record<PeriodoPuntaje, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  anual: "Anual",
};

function esTipo(v: string | undefined): v is PeriodoPuntaje {
  return PERIODOS_PUNTAJE.some((t) => t === v);
}

export async function PantallaRanking({
  esAdmin,
  tipoParam,
  periodoParam,
}: {
  esAdmin: boolean;
  tipoParam: string | undefined;
  periodoParam: string | undefined;
}) {
  const tenant = await tenantActivo();
  if (tenant === null) {
    return <Aviso>Elige un cliente en la cabecera para ver su ranking.</Aviso>;
  }

  const hoy = diaEnLima(new Date());
  const { filas, tipo, inicio, hayConfig, error } = await datosDeRanking(
    tenant.id,
    esTipo(tipoParam) ? tipoParam : null,
    periodoParam !== undefined && esFechaISO(periodoParam)
      ? periodoParam
      : null,
    hoy,
  );

  if (error !== null) return <Aviso>{error}</Aviso>;

  const base = esAdmin ? "/admin/ranking" : "/supervisor/ranking";
  const href = (t: PeriodoPuntaje, p: string) =>
    `${base}?tipo=${t}&periodo=${p}`;

  if (!hayConfig) {
    return (
      <Aviso>
        {tenant.nombre} no tiene plan de lealtad configurado, así que no hay
        puntajes que rankear. Se configura en{" "}
        <Link
          href={
            esAdmin
              ? "/admin/metricas?vista=merchandiser"
              : "/supervisor/metricas?vista=merchandiser"
          }
          className="font-semibold text-primary hover:underline"
        >
          Métricas y bonos
        </Link>
        .
      </Aviso>
    );
  }

  // Un periodo donde NADIE tiene cálculo no es «todos a cero»: el motor no ha
  // corrido. Se dice, y el botón de recálculo está al lado.
  const sinCalcular = filas.every((f) => f.calculado_at === null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Pestanas
          items={PERIODOS_PUNTAJE.map((t) => ({
            key: t,
            label: ETIQUETA_TIPO[t],
          }))}
          activa={tipo}
          href={(t) => `${base}?tipo=${t}`}
          etiqueta="Tipo de periodo"
        />
        <div className="flex-1" />
        <nav aria-label="Periodo" className="flex items-center gap-2">
          <Link
            href={href(tipo, periodoAnterior(tipo, inicio))}
            className={botonSecundario}
          >
            ←<span className="sr-only"> periodo anterior</span>
          </Link>
          <span className="min-w-28 text-center text-[13px] font-semibold">
            {etiquetaDePeriodo(tipo, inicio)}
          </span>
          <Link
            href={href(tipo, periodoSiguiente(tipo, inicio))}
            className={botonSecundario}
          >
            →<span className="sr-only"> periodo siguiente</span>
          </Link>
        </nav>
        <BotonRecalcular tipo={tipo} inicio={inicio} />
      </div>

      {filas.length === 0 ? (
        <Aviso>
          {tenant.nombre} no tiene mercaderistas con puntaje ni activos que
          rankear.
        </Aviso>
      ) : (
        <>
          {sinCalcular && (
            <Aviso>
              Este periodo aún no se ha calculado: «Sin datos» significa que el
              motor no ha corrido, no que todos puntúen cero. Recalcula para
              verlo.
            </Aviso>
          )}
          <TablaRanking
            filas={filas}
            hrefDetalle={(id) => `${base}/${id}?tipo=${tipo}&periodo=${inicio}`}
          />
        </>
      )}
    </div>
  );
}
