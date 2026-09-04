"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { fijarCodificado } from "@/lib/catalogo/acciones";
import { TD, TH } from "@/components/panel/tabla";

export type FilaCodificado = {
  sku_id: string;
  codigo: string;
  nombre: string;
  marca: string;
  codificado: boolean;
};

/**
 * La matriz de una tienda: cada SKU, con su interruptor de codificado. Cliente
 * porque el toggle escribe; el estado local espeja al servidor y se revierte si
 * la escritura falla, para no mentir sobre lo que quedó guardado.
 */
export function MatrizCodificados({
  tiendaId,
  filas,
}: {
  tiendaId: string;
  filas: FilaCodificado[];
}) {
  const [estado, setEstado] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(filas.map((f) => [f.sku_id, f.codificado])),
  );
  const [error, setError] = useState<string | null>(null);
  const [, empezar] = useTransition();
  const router = useRouter();

  function alternar(skuId: string, activo: boolean) {
    const previo = estado[skuId] ?? false;
    setEstado((e) => ({ ...e, [skuId]: activo }));
    setError(null);

    empezar(async () => {
      const r = await fijarCodificado({
        tienda_id: tiendaId,
        sku_id: skuId,
        activo,
      });
      if (!r.ok) {
        setEstado((e) => ({ ...e, [skuId]: previo })); // revertir: no quedó guardado
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  const codificados = filas.filter((f) => estado[f.sku_id]).length;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-muted-foreground" aria-live="polite">
        {codificados} de {filas.length} SKU codificados en esta tienda
      </p>
      {error !== null && (
        <p
          role="alert"
          className="rounded-[9px] bg-alerta-suave px-3 py-2 text-[13px] font-semibold text-alerta-texto"
        >
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                CODIFICADO
              </th>
              <th scope="col" className={TH}>
                SKU
              </th>
              <th scope="col" className={TH}>
                CÓDIGO
              </th>
              <th scope="col" className={TH}>
                MARCA
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr
                key={f.sku_id}
                className="border-b border-border last:border-0"
              >
                <td className={TD}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={estado[f.sku_id] ?? false}
                      onChange={(e) => alternar(f.sku_id, e.target.checked)}
                      className="size-4"
                      aria-label={`Codificar ${f.nombre} en esta tienda`}
                    />
                  </label>
                </td>
                <td className={`${TD} font-semibold`}>{f.nombre}</td>
                <td className={`${TD} font-mono`}>{f.codigo}</td>
                <td className={`${TD} text-muted-foreground`}>{f.marca}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
