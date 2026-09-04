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
 * El desenlace del guardado del checklist tras un check-in ya registrado. La
 * visita SIEMPRE queda (el checklist nunca la bloquea); lo que cambia es si se
 * navega al levantamiento o se queda el aviso a la vista: navegar con un aviso
 * pendiente lo desmontaría antes de que nadie lo lea.
 */
export function resultadoDelChecklist(estado: {
  checklistGuardado: boolean;
  fotosPerdidas: boolean;
}): { aviso: string; navegar: boolean } {
  if (!estado.checklistGuardado) {
    return {
      aviso:
        "El check-in quedó registrado, pero el checklist no se pudo guardar.",
      navegar: false,
    };
  }
  if (estado.fotosPerdidas) {
    return {
      aviso:
        "El check-in quedó registrado, pero la foto del checklist no se pudo guardar.",
      navegar: false,
    };
  }
  return { aviso: "", navegar: true };
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

type FormularioReplicado = {
  id: string;
  marca_id: string | null;
  creado_at: string;
  ambito: string | null;
};
type VersionReplicada = {
  id: string;
  formulario_id: string;
  version: number;
  definicion: string | null;
};

/**
 * Resuelve el checklist de check-in desde las filas de la réplica. `versionId`
 * null = sin checklist (no configurado, sin versión publicada, o definición
 * ilegible — degrada, no rompe: el check-in de geocerca + selfie sigue
 * completo). Pura salvo el aviso de configuración a medias.
 */
export function formularioCheckInDesde(
  formularios: FormularioReplicado[],
  versiones: VersionReplicada[],
): { versionId: string | null; campos: CampoFormulario[] } {
  const versionId = resolverVersionAnclada(formularios, versiones, {
    ambito: "check_in",
  });
  if (!versionId) {
    if (formularios.some((f) => f.ambito === "check_in")) {
      // Config a medias: el admin activó un checklist pero no publicó ninguna
      // versión. Sin este aviso, el síntoma sería "no sale nada" en silencio.
      console.warn("[check-in] hay un checklist activo sin versión publicada");
    }
    return { versionId: null, campos: [] };
  }
  const definicion = parseDefinicionFormulario(
    versiones.find((v) => v.id === versionId)?.definicion,
  );
  if (!definicion) return { versionId: null, campos: [] };
  return { versionId, campos: camposDeCheckIn(definicion) };
}

/** El checklist de check-in del cliente, reactivo desde la réplica local. */
export function useFormularioCheckIn(tenantId: string | null): {
  versionId: string | null;
  campos: CampoFormulario[];
} {
  const { data: formularios } = useQuery<FormularioReplicado>(
    `SELECT id, marca_id, creado_at, ambito FROM formulario_levantamiento
     WHERE tenant_id = ? AND activo = 1`,
    [tenantId ?? ""],
  );
  const { data: versiones } = useQuery<VersionReplicada>(
    `SELECT id, formulario_id, version, definicion FROM formulario_version
     WHERE tenant_id = ? AND publicada = 1`,
    [tenantId ?? ""],
  );

  return useMemo(
    () => formularioCheckInDesde(formularios, versiones),
    [formularios, versiones],
  );
}
