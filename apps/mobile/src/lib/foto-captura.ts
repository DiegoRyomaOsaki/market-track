import type { PuntoGeo } from "@market-track/shared";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

// El procesamiento de una foto capturada: comprimir y hashear. El watermark se
// GRABA en el pixel al capturar (ADR-0006) — eso lo hace el componente de cámara
// con react-native-view-shot; aquí ya llega la imagen aplanada.

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * Las líneas del watermark: coordenadas, fecha/hora local y usuario (ADR-0006).
 * Se calcula en la captura, no al subir — la subida puede ocurrir horas después.
 */
export function lineasWatermark(d: {
  capturado_at: string;
  lat: number | null;
  lng: number | null;
  usuario: string;
}): string[] {
  const f = new Date(d.capturado_at);
  const fecha = `${dos(f.getDate())}/${dos(f.getMonth() + 1)}/${f.getFullYear()} ${dos(f.getHours())}:${dos(f.getMinutes())}`;
  // Sin lectura de GPS se DICE que no la hubo. Escribir "0.000000, 0.000000"
  // sería marcar la foto con una coordenada real del golfo de Guinea.
  const coords =
    d.lat === null || d.lng === null
      ? "Sin ubicación"
      : `${d.lat.toFixed(6)}, ${d.lng.toFixed(6)}`;
  return [coords, fecha, d.usuario];
}

export type FotoProcesada = { ruta: string; hash: string };

/**
 * Lo que entrega la cámara: el archivo procesado más su evidencia de captura.
 * La hora y las coordenadas se sellan aquí, no al subir — la subida puede ocurrir
 * horas después (ADR-0006).
 */
export type FotoCapturada = FotoProcesada & {
  capturada_at: string;
  geo: PuntoGeo | null;
};

/**
 * Comprime la imagen (mid-range Android — CLAUDE.md) y calcula su hash SHA-256.
 * El hash es la huella de integridad que viaja como metadata por el motor de sync.
 */
export async function procesarFoto(uri: string): Promise<FotoProcesada> {
  const comprimida = await manipulateAsync(uri, [{ resize: { width: 1080 } }], {
    compress: 0.7,
    format: SaveFormat.JPEG,
  });
  const base64 = await FileSystem.readAsStringAsync(comprimida.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    base64,
  );
  return { ruta: comprimida.uri, hash };
}
