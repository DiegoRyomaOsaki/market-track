import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `@market-track/db` y `@market-track/shared` exportan TypeScript crudo
  // (`main: ./src/index.ts`), no JS compilado: Next debe transpilarlos.
  transpilePackages: ["@market-track/db", "@market-track/shared"],
  // `read-excel-file` se carga en runtime, no se empaqueta.
  //
  // Su dependencia `unzipper` hace `require('@aws-sdk/client-s3')` DENTRO de la
  // función `s3_v3`, que solo corre si alguien abre un zip desde S3 — cosa que
  // `read-excel-file` no hace nunca. Pero webpack resuelve los `require` de forma
  // estática, encuentra un paquete que no está instalado y aborta el build. Es un
  // fallo solo de empaquetado: en Node el `require` perezoso jamás se evalúa.
  //
  // Se marca externo en vez de instalar el SDK de AWS —varios MB para satisfacer
  // una rama muerta— o de aliasarlo a `false`, que enmascararía también un uso
  // real el día que lo hubiera.
  serverExternalPackages: ["read-excel-file"],
};

export default nextConfig;
