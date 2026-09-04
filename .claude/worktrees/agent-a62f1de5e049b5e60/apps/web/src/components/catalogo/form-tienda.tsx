"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { campo, Errores, etiqueta, Pie } from "@/components/panel/campos";
import { crearTienda, editarTienda } from "@/lib/catalogo/acciones";
import { leerCampo, leerCasilla } from "@/lib/formulario";

// MapLibre pesa cientos de KB y solo existe en el navegador: se carga aparte y
// bajo demanda, para que no lastre el bundle de las pantallas que no lo usan.
const MapaGeocerca = dynamic(
  () => import("./mapa-geocerca").then((m) => m.MapaGeocerca),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[340px] w-full items-center justify-center rounded-xl border border-border bg-muted text-[13px] text-muted-foreground">
        Cargando el mapa…
      </div>
    ),
  },
);

const RADIO_POR_DEFECTO = 100;

type Tienda = {
  id: string;
  nombre: string;
  tenant_id: string;
  cadena_id: string;
  direccion: string | null;
  cluster: string | null;
  codigo_externo: string | null;
  radio_geocerca_m: number;
  lat: number | null;
  lon: number | null;
  activo: boolean;
};

type Cadena = { id: string; nombre: string; tenant_id: string };

export function FormTienda({
  tienda,
  cadenas,
  urlTiles,
}: {
  tienda?: Tienda;
  cadenas: Cadena[];
  urlTiles: string | undefined;
}) {
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(
    tienda?.lat !== null && tienda?.lat !== undefined && tienda.lon !== null
      ? { lat: tienda.lat, lon: tienda.lon }
      : null,
  );
  const [radio, setRadio] = useState(
    tienda?.radio_geocerca_m ?? RADIO_POR_DEFECTO,
  );
  const [cadenaId, setCadenaId] = useState(
    tienda?.cadena_id ?? cadenas[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  // El cliente no se elige: lo hereda la cadena. Así no puede quedar una tienda
  // colgando de la cadena de otro cliente (la base también lo impide, con su FK
  // compuesta, pero un formulario que permite construir el error es un mal
  // formulario).
  const tenantDeLaCadena =
    cadenas.find((c) => c.id === cadenaId)?.tenant_id ?? "";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!punto) {
      setError("Marca la ubicación de la tienda en el mapa");
      return;
    }
    setEnviando(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const datos = {
      nombre: leerCampo(fd, "nombre"),
      tenant_id: tenantDeLaCadena,
      cadena_id: cadenaId,
      direccion: leerCampo(fd, "direccion"),
      cluster: leerCampo(fd, "cluster"),
      codigo_externo: leerCampo(fd, "codigo_externo"),
      radio_geocerca_m: Number(leerCampo(fd, "radio_geocerca_m")),
      lat: punto.lat,
      lon: punto.lon,
      activo: leerCasilla(fd, "activo"),
    };
    const r = tienda
      ? await editarTienda(tienda.id, datos)
      : await crearTienda(datos);

    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push("/admin/catalogo");
    router.refresh();
  }

  if (cadenas.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
        Una tienda pertenece a una cadena y todavía no hay ninguna. Crea primero
        la cadena.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-3xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Nombre de la tienda</span>
          <input
            name="nombre"
            required
            defaultValue={tienda?.nombre}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Cadena</span>
          <select
            name="cadena_id"
            required
            value={cadenaId}
            onChange={(e) => setCadenaId(e.target.value)}
            className={campo}
          >
            {cadenas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className={etiqueta}>Dirección (opcional)</span>
          <input
            name="direccion"
            defaultValue={tienda?.direccion ?? ""}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Cluster (opcional)</span>
          <input
            name="cluster"
            defaultValue={tienda?.cluster ?? ""}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Código externo (opcional)</span>
          <input
            name="codigo_externo"
            defaultValue={tienda?.codigo_externo ?? ""}
            className={campo}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={etiqueta}>Ubicación y geocerca</legend>
        <p className="text-[12px] text-muted-foreground">
          Haz clic en el mapa para marcar la puerta de la tienda. El círculo es
          la geocerca: fuera de ella el mercaderista no puede hacer check-in.
        </p>

        {urlTiles ? (
          <MapaGeocerca
            lat={punto?.lat ?? null}
            lon={punto?.lon ?? null}
            radioM={radio}
            urlTiles={urlTiles}
            onMover={(lat, lon) => setPunto({ lat, lon })}
          />
        ) : (
          <p
            role="alert"
            className="rounded-xl border border-dashed border-border bg-muted p-6 text-center text-[13px] text-muted-foreground"
          >
            No hay mapa base configurado (falta{" "}
            <code>NEXT_PUBLIC_TILES_URL</code>). En desarrollo:{" "}
            <code>pnpm --filter @market-track/web tiles:dev</code>.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Radio de la geocerca (m)</span>
            <input
              name="radio_geocerca_m"
              type="number"
              required
              min={1}
              step={1}
              value={radio}
              onChange={(e) => setRadio(Number(e.target.value))}
              className={`${campo} w-[160px]`}
            />
          </label>
          <p
            className="pb-2 text-[12px] text-muted-foreground"
            aria-live="polite"
          >
            {punto
              ? `Marcada en ${punto.lat.toFixed(5)}, ${punto.lon.toFixed(5)}`
              : "Sin marcar"}
          </p>
        </div>
      </fieldset>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="activo"
          defaultChecked={tienda?.activo ?? true}
          className="size-4"
        />
        <span className={etiqueta}>Activa</span>
      </label>

      <Errores error={error} />
      <Pie enviando={enviando} editando={!!tienda} volverA="/admin/catalogo" />
    </form>
  );
}
