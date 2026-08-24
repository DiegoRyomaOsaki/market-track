import Link from "next/link";

import { Aviso, Pastilla, Tarjeta, TD, TH } from "@/components/panel/tabla";
import type { PeriodoPuntaje } from "@market-track/shared";
import { datosDeDetalle, type ParadaDetalle } from "@/lib/ranking/datos";
import { ETIQUETA_ASISTENCIA, etiquetaDePeriodo } from "@/lib/ranking/ranking";

// De dónde sale cada punto: un ranking sin explicación se discute, no se usa.
//
// Nada se recalcula aquí. Los porcentajes y contadores son los que el motor
// guardó; los puntos por parada salen de la MISMA rampa que el motor promedió
// (`app.puntaje_de_parada`), con la configuración del puntaje guardado.

function pct(valor: number | null): string {
  return valor === null ? "Sin datos" : `${valor}`;
}

/** La hora de llegada, en Lima: el instante es global pero el turno es local. */
function horaEnLima(iso: string | null): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleTimeString("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function DetalleMercaderista({
  esAdmin,
  mercaderistaId,
  tipo,
  inicio,
}: {
  esAdmin: boolean;
  mercaderistaId: string;
  tipo: PeriodoPuntaje;
  inicio: string;
}) {
  const { nombre, puntaje, paradas, error } = await datosDeDetalle(
    mercaderistaId,
    tipo,
    inicio,
  );

  const volver = esAdmin ? "/admin/ranking" : "/supervisor/ranking";

  if (error !== null) return <Aviso>{error}</Aviso>;
  if (nombre === null) {
    // O no existe, o no es de tu equipo: para quien mira son lo mismo.
    return <Aviso>No se encontró a ese mercaderista.</Aviso>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`${volver}?tipo=${tipo}&periodo=${inicio}`}
          className="text-[13px] font-semibold text-primary hover:underline"
        >
          ← Volver al ranking
        </Link>
        <div className="flex-1" />
        <span className="text-[13px] font-semibold">
          {etiquetaDePeriodo(tipo, inicio)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-bold">{nombre}</h2>
        {puntaje !== null && (
          <>
            <span className="text-[13px] text-muted-foreground">
              Total: <strong>{pct(puntaje.total_pct)}</strong>
            </span>
            {puntaje.nivel !== null ? (
              <Pastilla tono="bg-completado-suave text-completado-texto">
                {puntaje.nivel.nombre} · S/ {puntaje.nivel.monto}
              </Pastilla>
            ) : (
              <Pastilla tono="bg-muted text-muted-foreground">
                Sin nivel de bono
              </Pastilla>
            )}
            {puntaje.cierre_bloqueado && (
              <Pastilla tono="bg-alerta-suave text-alerta-texto">
                Cierre bloqueado
              </Pastilla>
            )}
          </>
        )}
      </div>

      {puntaje === null ? (
        <Aviso>
          Este periodo no se ha calculado para {nombre}. Los hechos de abajo son
          los registrados; los puntos por parada son una previa con la
          configuración vigente.
        </Aviso>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <VariableCard
            titulo="Puntualidad"
            valor={pct(puntaje.puntualidad_pct)}
            explicacion={`${puntaje.paradas_puntuales} de ${puntaje.paradas_con_hora} paradas con hora llegaron dentro de la tolerancia`}
          />
          <VariableCard
            titulo="Asistencia"
            valor={pct(puntaje.asistencia_pct)}
            explicacion={`${puntaje.paradas_asistidas} de ${puntaje.paradas_evaluables} paradas evaluables asistidas`}
          />
          <VariableCard
            titulo="Calidad de registro"
            valor={pct(puntaje.calidad_pct)}
            explicacion={`${puntaje.campos_respondidos} de ${puntaje.campos_obligatorios} campos respondidos · ${puntaje.fotos_presentes} de ${puntaje.fotos_esperadas} fotos con sello del servidor`}
          />
          <VariableCard
            titulo="Herramientas"
            valor={pct(puntaje.herramientas_pct)}
            explicacion={`${puntaje.items_cumplidos} de ${puntaje.items_checklist} ítems del checklist declarados`}
          />
        </section>
      )}

      {puntaje !== null && (
        <section className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4 text-[12.5px] text-muted-foreground">
          <p>
            Evidencia del periodo: {puntaje.fotos_verificadas} de{" "}
            {puntaje.fotos_subidas} fotos subidas tienen el sello del servidor (
            {puntaje.fotos_del_periodo} capturadas en total).
            {puntaje.cierre_bloqueado &&
              puntaje.config !== null &&
              ` El periodo no se cerró: el porcentaje sin verificar supera el umbral del ${puntaje.config.umbral_fotos_sin_verificar_pct}%. No es mal desempeño — es evidencia pendiente de sellar.`}
          </p>
          {puntaje.config !== null && (
            <p>
              Reglas del periodo: tolerancia de{" "}
              {puntaje.config.tolerancia_puntualidad_min} min; una tardanza
              puntúa 0 desde los {puntaje.config.minutos_tardanza_cero} min.
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[11.5px] font-semibold text-muted-foreground">
          PARADAS DEL PERIODO · de aquí salen puntualidad y asistencia
        </h3>
        {paradas.length === 0 ? (
          <Aviso>No hay paradas planificadas en este periodo.</Aviso>
        ) : (
          <TablaParadas paradas={paradas} />
        )}
      </section>
    </div>
  );
}

function VariableCard({
  titulo,
  valor,
  explicacion,
}: {
  titulo: string;
  valor: string;
  explicacion: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-background p-4">
      <span className="text-[11.5px] font-semibold text-muted-foreground">
        {titulo.toUpperCase()}
      </span>
      <span className="text-[20px] font-bold tabular-nums">{valor}</span>
      <span className="text-[12px] text-muted-foreground">{explicacion}</span>
    </div>
  );
}

function TablaParadas({ paradas }: { paradas: ParadaDetalle[] }) {
  return (
    <Tarjeta>
      <thead>
        <tr className="border-b border-border bg-muted/40">
          <th scope="col" className={TH}>
            FECHA
          </th>
          <th scope="col" className={TH}>
            TIENDA
          </th>
          <th scope="col" className={TH}>
            HORA ESPERADA
          </th>
          <th scope="col" className={TH}>
            LLEGADA
          </th>
          <th scope="col" className={TH}>
            DESVÍO
          </th>
          <th scope="col" className={TH}>
            ASISTENCIA
          </th>
          <th scope="col" className={TH}>
            PUNTOS
          </th>
        </tr>
      </thead>
      <tbody>
        {paradas.map((p) => (
          <tr
            key={p.parada_id}
            className="border-b border-border last:border-0"
          >
            <td className={`${TD} tabular-nums`}>{p.fecha}</td>
            <td className={`${TD} font-semibold`}>{p.tienda_nombre ?? "—"}</td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              {p.hora_planificada === null
                ? "Sin hora"
                : p.hora_planificada.slice(0, 5)}
            </td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              {horaEnLima(p.check_in_at)}
            </td>
            <td className={`${TD} tabular-nums text-muted-foreground`}>
              {p.minutos_desvio === null
                ? "—"
                : p.minutos_desvio > 0
                  ? `+${p.minutos_desvio} min`
                  : `${p.minutos_desvio} min`}
            </td>
            <td className={TD}>
              {/* Texto siempre: el estado nunca viaja solo en un color. */}
              {p.asistencia === "falto" ? (
                <Pastilla tono="bg-alerta-suave text-alerta-texto">
                  {ETIQUETA_ASISTENCIA[p.asistencia]}
                </Pastilla>
              ) : p.asistencia === "asistio" ? (
                <Pastilla tono="bg-completado-suave text-completado-texto">
                  {ETIQUETA_ASISTENCIA[p.asistencia]}
                </Pastilla>
              ) : (
                <Pastilla tono="bg-muted text-muted-foreground">
                  {ETIQUETA_ASISTENCIA[p.asistencia]}
                </Pastilla>
              )}
            </td>
            <td className={`${TD} font-semibold tabular-nums`}>
              {/* NULL = la parada no puntúa (sin hora o pendiente): no es un 0. */}
              {p.puntos === null ? "—" : p.puntos}
            </td>
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}
