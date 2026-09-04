import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Checks ESTÁTICOS de las sync rules: rápidos, sin servicios, corren en CI.
// El aislamiento en vivo (que exige el servicio PowerSync levantado) va en
// test/aislamiento.sync.test.ts, bajo `test:sync`.

const streams = readFileSync(
  fileURLToPath(new URL("../config/streams.yaml", import.meta.url)),
  "utf8",
);

describe("streams.yaml — contrato de seguridad", () => {
  it("es edición 3 (la legacy con request.user_id() está obsoleta)", () => {
    expect(streams).toMatch(/edition:\s*3/);
    // request.user_id() es sintaxis legacy: en edición 3 se rechaza al arrancar.
    expect(streams).not.toMatch(/request\.user_id\(\)/);
  });

  it("el acceso se apoya en el usuario del token, no en el cliente", () => {
    expect(streams).toMatch(/auth\.user_id\(\)/);
  });

  it("NUNCA filtra por parámetros que controla el cliente", () => {
    // connection.parameter y subscription.parameter los envía el cliente y puede
    // poner cualquier valor: usarlos para control de acceso es la fuga entre
    // marcas. El aislamiento solo puede venir de auth.* (del JWT firmado).
    expect(streams).not.toMatch(/connection\.parameter/);
    expect(streams).not.toMatch(/subscription\.parameter/);
  });

  it("exige el segundo factor en la bajada (gate aal2, MAR-71)", () => {
    // El gate aal2 de la RLS no cubre lo que PowerSync descarga: hay que exigir
    // el claim aal en la propia regla, o una sesión aal1 recibe datos igual.
    expect(streams).toMatch(/auth\.parameter\('aal'\)\s*=\s*'aal2'/);
  });

  it("la revisión de reportes se acota a las visitas del propio usuario", () => {
    // Sin el `visita_id IN (... mercaderista_id = auth.user_id())`, la regla se
    // quedaría en el filtro por tenant y cada teléfono bajaría el control de
    // calidad de todos sus compañeros.
    expect(streams).toMatch(
      /FROM revision_visita WHERE .*visita_id IN \(SELECT id FROM visita WHERE mercaderista_id = auth\.user_id\(\)\)/,
    );
  });

  it("la metadata de fotos se acota a las visitas del propio usuario", () => {
    // El binario va por otro canal, pero la fila baja por aquí: sin el IN, cada
    // teléfono se traería la evidencia de todos sus compañeros.
    expect(streams).toMatch(
      /FROM foto WHERE .*visita_id IN \(SELECT id FROM visita WHERE mercaderista_id = auth\.user_id\(\)\)/,
    );
  });

  it("el checklist de check-in se acota a las visitas del propio usuario", () => {
    // Sin el IN, cada teléfono bajaría las respuestas del checklist de todos
    // sus compañeros — dato laboral de otros, no suyo.
    expect(streams).toMatch(
      /FROM visita_respuesta WHERE .*visita_id IN \(SELECT id FROM visita WHERE mercaderista_id = auth\.user_id\(\)\)/,
    );
  });

  it("el levantamiento, la contingencia y la incidencia se acotan a las visitas del propio usuario", () => {
    // Filtrar solo por tenant hacía que cada teléfono replicara el historial de
    // levantamientos y bypasses de TODOS sus compañeros. La incidencia nace del
    // mismo sitio y dice lo mismo de la tienda de al lado.
    for (const tabla of ["levantamiento", "contingencia", "incidencia"]) {
      expect(streams).toMatch(
        new RegExp(
          String.raw`FROM ${tabla} WHERE .*visita_id IN \(SELECT id FROM visita WHERE mercaderista_id = auth\.user_id\(\)\)`,
        ),
      );
    }
  });

  it("lo que cuelga del levantamiento se acota a los levantamientos de SUS visitas", () => {
    // Skus, respuestas del formulario y exhibiciones auditadas no tienen
    // visita_id: se acotan por el levantamiento, y este por la visita propia.
    for (const tabla of [
      "levantamiento_sku",
      "levantamiento_respuesta",
      "levantamiento_paso",
      "exhibicion",
    ]) {
      expect(streams).toMatch(
        new RegExp(
          String.raw`FROM ${tabla} WHERE .*levantamiento_id IN \(SELECT id FROM levantamiento WHERE visita_id IN \(SELECT id FROM visita WHERE mercaderista_id = auth\.user_id\(\)\)\)`,
        ),
      );
    }
  });

  it("ningún stream de trabajo de campo se queda en el filtro por tenant", () => {
    // Un `WHERE tenant_id IN (...)` a secas sobre estas tablas es la fuga: baja
    // el tenant entero. Solo el maestro comercial puede bajar así.
    for (const tabla of [
      "visita",
      "levantamiento",
      "levantamiento_sku",
      "levantamiento_respuesta",
      "visita_respuesta",
      "exhibicion",
      "foto",
      "contingencia",
      "revision_visita",
      "solicitud_cambio_ruta",
      "incidencia",
      "levantamiento_paso",
    ]) {
      expect(streams).not.toMatch(
        new RegExp(
          String.raw`FROM ${tabla} WHERE tenant_id IN \(SELECT tenant_id FROM mi_tenant\)\s*$`,
          "m",
        ),
      );
    }
  });

  it("exige acceso efectivo: usuario activo y su cliente activo", () => {
    // Espeja app.perfil_efectivo(): si el cliente se cancela, deja de replicar.
    expect(streams).toMatch(/p\.activo\s*=\s*true/);
    expect(streams).toMatch(/t\.activo\s*=\s*true/);
  });
});

describe("streams.yaml — el plan de lealtad en el teléfono", () => {
  /**
   * Las columnas que una query del stream proyecta. Se busca la LÍNEA y no con
   * una regex sobre el archivo entero: los comentarios de arriba nombran las
   * columnas que a propósito NO bajan, y una regex multilínea las capturaría —
   * dejando el pin de contrato en verde con la columna realmente presente.
   */
  function proyeccionDe(tabla: string): string {
    const marca = ` FROM ${tabla} `;
    const linea = streams
      .split("\n")
      .find((l) => l.trimStart().startsWith("- SELECT") && l.includes(marca));
    if (linea === undefined) throw new Error(`sin query para ${tabla}`);
    return linea.slice(linea.indexOf("SELECT ") + 7, linea.indexOf(marca));
  }

  it("el puntaje se acota al PROPIO usuario, no al cliente", () => {
    // El caso que el filtro por tenant NO cubre: un compañero del MISMO cliente.
    // Y el cliente lo decidió explícitamente — "que tú veas tu puntaje y tu
    // posición, tú solo" —, así que esto es alcance, no solo higiene.
    expect(streams).toMatch(
      /FROM puntaje_merchandiser WHERE .*mercaderista_id = auth\.user_id\(\)/,
    );
  });

  it("el puntaje NO baja el bono ni la salud del pipeline", () => {
    // Pin de contrato: el monto del bono es la relación laboral entre la
    // outsourcing y su personal, no algo que viva en un teléfono que se pierde.
    // Una assertion por valor: una regresión aquí es silenciosa.
    const proyeccion = proyeccionDe("puntaje_merchandiser");
    for (const columna of [
      "nivel_bono_id",
      "config_id",
      "cierre_bloqueado",
      "fotos_del_periodo",
      "fotos_subidas",
      "fotos_verificadas",
    ]) {
      expect(proyeccion).not.toContain(columna);
    }
  });

  it("el puntaje SÍ baja la posición guardada y su denominador", () => {
    // El teléfono tiene UNA fila: sin estas tres columnas no puede enseñar la
    // posición, y recalcularla en el móvil es justo lo que se descartó.
    const proyeccion = proyeccionDe("puntaje_merchandiser");
    for (const columna of [
      "posicion",
      "mercaderistas_evaluados",
      "hay_empate",
    ]) {
      expect(proyeccion).toContain(columna);
    }
  });

  it("el Perfect Store se acota a los levantamientos de SUS visitas", () => {
    expect(streams).toMatch(
      /FROM puntaje_perfect_store WHERE .*levantamiento_id IN \(SELECT id FROM levantamiento WHERE visita_id IN \(SELECT id FROM visita WHERE mercaderista_id = auth\.user_id\(\)\)\)/,
    );
  });

  it("el Perfect Store viaja con un `id` propio (PowerSync lo exige)", () => {
    // La PK de esa tabla es `levantamiento_id`; sin el alias, PowerSync no sabe
    // identificar la fila y no la replica.
    expect(streams).toMatch(
      /SELECT levantamiento_id AS id, .*FROM puntaje_perfect_store/,
    );
  });

  it("de la configuración solo baja la periodicidad, nunca los pesos", () => {
    // Los pesos son la política laboral del cliente. El móvil solo necesita
    // saber si su periodo es mensual, trimestral o anual.
    const proyeccion = proyeccionDe("config_perfect_merchandiser");
    expect(proyeccion).toContain("periodicidad");
    for (const columna of [
      "peso_puntualidad",
      "peso_asistencia",
      "peso_calidad",
      "peso_herramientas",
      "tolerancia_puntualidad_min",
    ]) {
      expect(proyeccion).not.toContain(columna);
    }
  });

  it("ni el puntaje ni el Perfect Store se quedan en el filtro por tenant", () => {
    for (const tabla of ["puntaje_merchandiser", "puntaje_perfect_store"]) {
      expect(streams).not.toMatch(
        new RegExp(
          String.raw`FROM ${tabla} WHERE tenant_id IN \(SELECT tenant_id FROM mi_tenant\)\s*$`,
          "m",
        ),
      );
    }
  });
});
