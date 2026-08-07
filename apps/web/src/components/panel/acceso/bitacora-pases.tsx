import type { EstadoPase } from "@market-track/shared";

import { Pastilla, Tarjeta, TD, TH } from "@/components/panel/tabla";
import {
  ESTILO_ESTADO_PASE,
  ETIQUETA_ESTADO_PASE,
  sePuedeRevocar,
} from "@/lib/panel/acceso";

import { BotonRevocar } from "./boton-revocar";

// La bitácora de pases. Server Component: lo único interactivo es el botón de
// revocar, que es una hoja.
//
// Responde a una sola pregunta: quién le dio acceso a quién, cuándo y por qué.
// El código nunca aparece aquí — ni siquiera su hash tiene grant de lectura.

export type FilaPase = {
  id: string;
  usuario_nombre: string | null;
  emisor_nombre: string | null;
  motivo: string;
  estado: EstadoPase;
  generado_at: string;
};

const FECHA = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Lima",
});

/** Un perfil que la RLS esconde deja un hueco, no borra la fila de la bitácora. */
function oGuion(v: string | null) {
  return v ?? "—";
}

export function BitacoraPases({ pases }: { pases: FilaPase[] }) {
  if (pases.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-background p-4 text-[13px] text-muted-foreground">
        Todavía no se ha emitido ningún pase.
      </p>
    );
  }

  return (
    <Tarjeta>
      <thead>
        <tr className="border-b border-border">
          <th className={TH}>Mercaderista</th>
          <th className={TH}>Motivo</th>
          <th className={TH}>Lo emitió</th>
          <th className={TH}>Estado</th>
          <th className={TH}>Emitido</th>
          <th className={TH}>
            <span className="sr-only">Acciones</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {pases.map((p) => (
          <tr key={p.id} className="border-b border-border last:border-0">
            <td className={`${TD} font-semibold`}>
              {oGuion(p.usuario_nombre)}
            </td>
            <td className={TD}>{p.motivo}</td>
            <td className={TD}>{oGuion(p.emisor_nombre)}</td>
            <td className={TD}>
              <Pastilla tono={ESTILO_ESTADO_PASE[p.estado]}>
                {ETIQUETA_ESTADO_PASE[p.estado]}
              </Pastilla>
            </td>
            <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
              {FECHA.format(new Date(p.generado_at))}
            </td>
            <td className={TD}>
              {sePuedeRevocar(p.estado) ? <BotonRevocar paseId={p.id} /> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </Tarjeta>
  );
}
