import type {
  CampoFormulario,
  DefinicionFormulario,
} from "@market-track/shared";
import { useQuery } from "@powersync/react-native";
import { useMemo } from "react";

import {
  coercionValorRespuesta,
  estaContestado,
  parseDefinicionFormulario,
  resolverVersionAnclada,
  type RespuestaCruda,
  type ValorRespuesta,
} from "./formulario";

// Reglas del check-in, fuera de la UI (espejo de check-out.ts). El check-in
// exige ubicación y selfie; el checklist de herramientas (MAR-98) NUNCA entra al
// gate: se registra lo que haya y afecta al puntaje, no al flujo.

/** ¿Se puede confirmar? El checklist no participa a propósito: no es argumento. */
export function puedeConfirmarCheckIn(estado: {
  ubicacionOk: boolean;
  selfieTomada: boolean;
  guardando: boolean;
}): boolean {
  return estado.ubicacionOk && estado.selfieTomada && !estado.guardando;
}

/** Los campos del checklist, aplanados por el `orden` de sus pasos. */
export function camposDeCheckIn(
  definicion: DefinicionFormulario | null,
): CampoFormulario[] {
  if (!definicion) return [];
  return [...definicion.pasos]
    .sort((a, b) => a.orden - b.orden)
    .flatMap((p) => p.campos);
}

/**
 * Las filas a guardar: una por campo CONTESTADO, con el valor coercionado. Un
 * campo sin contestar (incluida la foto sin capturar) no produce fila — la
 * ausencia es derivable de la definición anclada, no un centinela guardado.
 */
export function respuestasDeCheckIn(
  campos: CampoFormulario[],
  valores: Record<string, RespuestaCruda>,
): { campo_id: string; valor: ValorRespuesta }[] {
  return campos
    .filter((c) => estaContestado(valores[c.id]))
    .map((c) => ({
      campo_id: c.id,
      valor: coercionValorRespuesta(c, valores[c.id]),
    }));
}

/**
 * El checklist de check-in del cliente: la versión publicada del formulario de
 * ámbito `check_in` más reciente, ya parseada. `versionId` null = sin checklist
 * (no configurado, sin versión publicada, o definición ilegible — degrada, no
 * rompe: el check-in de geocerca + selfie sigue completo).
 */
export function useFormularioCheckIn(tenantId: string | null): {
  versionId: string | null;
  campos: CampoFormulario[];
} {
  const { data: formularios } = useQuery<{
    id: string;
    marca_id: string | null;
    creado_at: string;
    ambito: string | null;
  }>(
    `SELECT id, marca_id, creado_at, ambito FROM formulario_levantamiento
     WHERE tenant_id = ? AND activo = 1`,
    [tenantId ?? ""],
  );
  const { data: versiones } = useQuery<{
    id: string;
    formulario_id: string;
    version: number;
    definicion: string | null;
  }>(
    `SELECT id, formulario_id, version, definicion FROM formulario_version
     WHERE tenant_id = ? AND publicada = 1`,
    [tenantId ?? ""],
  );

  return useMemo(() => {
    const versionId = resolverVersionAnclada(formularios, versiones, {
      ambito: "check_in",
    });
    const hayChecklistActivo = formularios.some((f) => f.ambito === "check_in");
    if (!versionId) {
      if (hayChecklistActivo) {
        // Config a medias: el admin activó un checklist pero no publicó ninguna
        // versión. Sin este aviso, el síntoma sería "no sale nada" en silencio.
        console.warn(
          "[check-in] hay un checklist activo sin versión publicada",
        );
      }
      return { versionId: null, campos: [] };
    }
    const definicion = parseDefinicionFormulario(
      versiones.find((v) => v.id === versionId)?.definicion,
    );
    if (!definicion) return { versionId: null, campos: [] };
    return { versionId, campos: camposDeCheckIn(definicion) };
  }, [formularios, versiones]);
}
