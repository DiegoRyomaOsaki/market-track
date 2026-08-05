import { describe, expect, it } from "vitest";

import type { PinMapa } from "@/lib/mapa/pines";

import { coleccion, htmlDeBurbuja } from "./mapa-pines-inner";

// La burbuja del pin. Se prueban las DOS capas encadenadas —`coleccion` arma las
// propiedades del feature y `htmlDeBurbuja` las pinta— porque el fallo que
// motivó estos tests solo existía en la costura: `coleccion` convertía el vacío
// en "#" y la burbuja veía un destino donde no lo había.

const PIN: PinMapa = {
  id: "t1",
  nombre: "Plaza Vea Surco",
  lat: -12.1,
  lon: -77,
  color: "verde",
  href: "/cliente/tienda/t1",
  descripcion: "Visitada",
};

/** El camino real: del pin al HTML, sin saltarse `coleccion`. */
function burbujaDe(pin: PinMapa): string {
  const props = coleccion([pin]).features[0]?.properties ?? {};
  return htmlDeBurbuja(props, "Ver evidencia");
}

describe("la burbuja del pin", () => {
  it("con destino pinta el enlace", () => {
    const html = burbujaDe(PIN);
    expect(html).toContain('<a href="/cliente/tienda/t1"');
    expect(html).toContain("Ver evidencia");
  });

  it("SIN destino no pinta ningún ancla", () => {
    // El cliente con la galería deshabilitada. Un enlace a "#" sería peor que
    // ninguno: parece pulsable y no lleva a nada.
    expect(burbujaDe({ ...PIN, href: "" })).not.toContain("<a ");
  });

  it("siempre enseña el nombre de la tienda, haya enlace o no", () => {
    expect(burbujaDe({ ...PIN, href: "" })).toContain("Plaza Vea Surco");
  });

  it("una ruta que no es interna no llega al atributo", () => {
    // `javascript:` sigue siendo ejecutable después de escapar entidades, así
    // que el filtro no puede ser el escapado.
    for (const href of [
      "javascript:alert(1)",
      "//evil.com",
      "https://evil.com",
    ]) {
      const html = burbujaDe({ ...PIN, href });
      expect(html).toContain('href="#"');
      expect(html).not.toContain("evil.com");
      expect(html).not.toContain("javascript:");
    }
  });

  it("el nombre no puede romper el HTML de la burbuja", () => {
    const html = burbujaDe({
      ...PIN,
      nombre: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
