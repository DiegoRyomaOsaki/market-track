import Link from "next/link";

import { Pestanas } from "@/components/panel/pestanas";
import { Aviso, Tarjeta, TD, TH } from "@/components/panel/tabla";
import { diaEnLima } from "@/lib/fecha-lima";
import { datosDeMetricas } from "@/lib/metricas/datos";
import { ETIQUETA_PERIODO, ETIQUETA_TIPO_TIENDA } from "@/lib/metricas/textos";
import { tenantActivo } from "@/lib/panel/tenant-activo";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { EditorEscalera } from "./editor-escalera";
import { FormMerchandiser } from "./form-merchandiser";
import { FormPerfectStore } from "./form-perfect-store";

// La configuración de las dos métricas, compartida por admin y supervisor.
//
// Es la misma pantalla porque los dos miran lo mismo; lo que cambia es si se
// puede publicar. Eso NO lo decide esta plantilla: lo decide la RLS
// (`*_admin_escribe`). Aquí solo se deshabilitan los controles para no ofrecer
// un botón que terminaría en error — la UI es cortesía, no seguridad.

export const VISTAS = [
  { key: "perfect-store", label: "Perfect Store" },
  { key: "merchandiser", label: "Plan de lealtad" },
] as const;

export type VistaMetricas = (typeof VISTAS)[number]["key"];

export async function PantallaMetricas({
  esAdmin,
  vista,
  marcaId,
}: {
  esAdmin: boolean;
  vista: VistaMetricas;
  marcaId: string | null;
}) {
  const tenant = await tenantActivo();
  if (tenant === null) {
    return (
      <Aviso>
        Elige un cliente en la cabecera para configurar sus métricas.
      </Aviso>
    );
  }

  const { marcas, configsStore, configMerchandiser, escalera, error } =
    await datosDeMetricas(tenant.id, marcaId);
  if (error !== null) return <Aviso>{error}</Aviso>;

  // El día de LIMA, resuelto en el servidor: `new Date()` en el navegador daría
  // el día del dispositivo, y una versión "vigente desde mañana" no rige hoy.
  const hoy = diaEnLima(new Date());
  const base = esAdmin ? "/admin/metricas" : "/supervisor/metricas";
  const marcaElegida = marcaId ?? marcas[0]?.id ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Pestanas
        items={VISTAS}
        activa={vista}
        href={(k) => `${base}?vista=${k}`}
        etiqueta="Métricas"
      />

      {vista === "perfect-store" ? (
        <PerfectStore
          tenantId={tenant.id}
          marcas={marcas}
          marcaElegida={marcaElegida}
          configs={configsStore}
          base={base}
          esAdmin={esAdmin}
          hoy={hoy}
        />
      ) : (
        <section className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
            <div>
              <h2 className="text-[13px] font-bold">
                Pesos del plan de lealtad
              </h2>
              <p className="text-[11.5px] text-muted-foreground">
                {configMerchandiser
                  ? `Vigente desde ${configMerchandiser.vigente_desde} · plan ${ETIQUETA_PERIODO[configMerchandiser.periodicidad].toLowerCase()}`
                  : "Este cliente todavía no tiene configuración: publica la primera versión."}
              </p>
            </div>
            <FormMerchandiser
              tenantId={tenant.id}
              vigente={configMerchandiser}
              soloLectura={!esAdmin}
              hoy={hoy}
            />
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
            <div>
              <h2 className="text-[13px] font-bold">Escalera de bonos</h2>
              <p className="text-[11.5px] text-muted-foreground">
                Cada nivel es un umbral: quien llega a ese puntaje cobra ese
                bono. Publicar una escalera reemplaza la anterior entera.
              </p>
            </div>
            <EditorEscalera
              tenantId={tenant.id}
              vigente={escalera}
              soloLectura={!esAdmin}
              hoy={hoy}
            />
          </section>
        </section>
      )}
    </div>
  );
}

async function PerfectStore({
  tenantId,
  marcas,
  marcaElegida,
  configs,
  base,
  esAdmin,
  hoy,
}: {
  tenantId: string;
  marcas: { id: string; nombre: string }[];
  marcaElegida: string | null;
  configs: Awaited<ReturnType<typeof datosDeMetricas>>["configsStore"];
  base: string;
  esAdmin: boolean;
  hoy: string;
}) {
  if (marcas.length === 0) {
    return (
      <Aviso>
        Este cliente no tiene marcas activas. Perfect Store se configura por
        marca.
      </Aviso>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: categorias } = await supabase
    .from("categoria")
    .select("id, nombre")
    .eq("tenant_id", tenantId)
    .order("nombre");

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Marca" className="flex flex-wrap gap-1.5">
        {marcas.map((m) => (
          <Link
            key={m.id}
            href={`${base}?vista=perfect-store&marca=${m.id}`}
            aria-current={m.id === marcaElegida ? "page" : undefined}
            className={`rounded-[9px] border px-3 py-1.5 text-[12.5px] font-semibold ${
              m.id === marcaElegida
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            {m.nombre}
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <div>
          <h2 className="text-[13px] font-bold">Configuraciones vigentes</h2>
          <p className="text-[11.5px] text-muted-foreground">
            Gana la fila más específica: la categoría pesa más que el tipo de
            tienda. A igual especificidad, la vigente más reciente.
          </p>
        </div>
        {configs.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Esta marca todavía no tiene configuración de Perfect Store.
          </p>
        ) : (
          <Tarjeta>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  APLICA A
                </th>
                <th scope="col" className={TH}>
                  PESOS (D/V/P/POP/O)
                </th>
                <th scope="col" className={TH}>
                  OBJETIVO SOS
                </th>
                <th scope="col" className={TH}>
                  DESDE
                </th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className={TD}>
                    {c.categoria_nombre ?? "Todas las categorías"}
                    <span className="text-muted-foreground">
                      {c.tipo_tienda
                        ? ` · ${ETIQUETA_TIPO_TIENDA[c.tipo_tienda]}`
                        : " · todos los tipos"}
                    </span>
                  </td>
                  <td className={`${TD} text-muted-foreground`}>
                    {`${c.peso_distribucion}/${c.peso_visibilidad}/${c.peso_precio}/${c.peso_pop}/${c.peso_orden}`}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>
                    {`${c.sos_objetivo_pct}%`}
                  </td>
                  <td className={`${TD} text-muted-foreground`}>
                    {c.vigente_desde}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tarjeta>
        )}
      </section>

      {marcaElegida ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
          <h2 className="text-[13px] font-bold">
            {esAdmin ? "Publicar una versión" : "Configuración"}
          </h2>
          <FormPerfectStore
            // Remontar al cambiar de marca: si no, los pesos tecleados para una
            // marca se publicarían en la siguiente.
            key={marcaElegida}
            tenantId={tenantId}
            marcaId={marcaElegida}
            categorias={categorias ?? []}
            soloLectura={!esAdmin}
            hoy={hoy}
          />
        </section>
      ) : null}
    </div>
  );
}
