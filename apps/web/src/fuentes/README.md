# Fuentes auto-hospedadas

Los `.woff2` de aquí se cargan con `next/font/local` desde
`src/app/layout.tsx`. **Nada de `next/font/google` en esta app**: esa API
descarga la fuente de `fonts.gstatic.com` en tiempo de build, así que `next
build` dejaba de compilar cuando el runner se quedaba sin red — un CI rojo por
algo ajeno al cambio, que es la forma más rápida de que el rojo deje de mirarse.
Mismo criterio que el extracto de tiles del mapa (ADR-0009): se baja una vez y
deja de depender de que un tercero esté disponible para compilar.

## Qué hay y de dónde salió

Son **exactamente** los ficheros que `next/font/google` habría descargado: el
subconjunto **latin** que sirve Google para cada familia, con
`subsets: ["latin"]`, que es lo que la app pedía antes.

| Fichero | Familia | Pesos | Origen |
|---|---|---|---|
| `public-sans-latin-variable.woff2` | Public Sans v21 | eje `wght` 100–900 | `fonts.gstatic.com/s/publicsans/v21/ijwRs572Xtc6ZYQws9YVwnNGfJ4.woff2` |
| `ibm-plex-mono-latin-400.woff2` | IBM Plex Mono v20 | 400 | `fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2` |
| `ibm-plex-mono-latin-500.woff2` | IBM Plex Mono v20 | 500 | `fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2` |

**Public Sans es una fuente variable**, y por eso un solo fichero cubre los cinco
pesos que usa la UI (400, 500, 600, 700, 800): Google sirve el mismo `.woff2`
para todos ellos. IBM Plex Mono no lo es, y cada peso es su propio fichero.

## Licencias

Ambas familias son **SIL Open Font License 1.1**, y la OFL exige que la licencia
viaje con el fichero. Están en `LICENSE-public-sans.txt` y
`LICENSE-ibm-plex-mono.txt`, copiadas del repositorio `google/fonts`, que es la
misma fuente que sirve los `.woff2`.

## Cómo actualizarlas

Las URL de `gstatic` llevan la versión dentro (`/v21/`, `/v20/`) y **cambian
cuando Google publica una revisión**. Para refrescar, pide el CSS con un
*user agent* de navegador moderno —sin él Google devuelve `.ttf` en vez de
`.woff2`— y quédate con el bloque `/* latin */`:

```bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
curl -sS -A "$UA" 'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&display=swap'
curl -sS -A "$UA" 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap'
```

Al cambiar de versión, actualiza también la tabla de arriba: es lo único que dice
qué hay dentro de estos binarios.
