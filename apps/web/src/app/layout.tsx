import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "./globals.css";

// Public Sans para la UI, IBM Plex Mono para datos/códigos (precios, DNI, SKUs).
//
// Los ficheros están EN EL REPOSITORIO y se cargan con `next/font/local`, no con
// `next/font/google`: esa API auto-hospeda la fuente en runtime (que es lo que
// queremos) pero para lograrlo la DESCARGA en tiempo de build desde
// `fonts.gstatic.com`. O sea, `next build` necesitaba salida a internet, y un
// fallo de red ponía el CI rojo por algo que no tenía nada que ver con el
// cambio. Un rojo que miente deja de mirarse, y aquí los checks obligatorios
// están tras el muro de pago de GitHub Pro: mirarlo es todo lo que hay.
//
// De dónde salen los ficheros y cómo se actualizan: `src/fuentes/README.md`.
const publicSans = localFont({
  // Public Sans es VARIABLE: un solo fichero cubre todo el eje de peso, así que
  // los cinco pesos que usa la UI (400-800) salen de aquí. El rango es el del
  // eje `wght` de la fuente, comprobado contra la API de Google Fonts: 100..900
  // responde 200, y 99 o 901 responden 400.
  src: "../fuentes/public-sans-latin-variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-public-sans",
  display: "swap",
});

const plexMono = localFont({
  // IBM Plex Mono NO es variable: cada peso es su propio fichero.
  src: [
    {
      path: "../fuentes/ibm-plex-mono-latin-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fuentes/ibm-plex-mono-latin-500.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Market Track",
  description: "Panel de gestión — Market Track",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${publicSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
