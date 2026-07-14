import { describe, expect, it } from "vitest";

import { Constants } from "./index";
import type { Enums } from "./index";

// El enum `rol_usuario` no es una lista cualquiera: es la que gobierna las
// políticas RLS. Si una migración le añade o le quita un rol, este archivo tiene
// que ponerse rojo — añadir un rol sin revisar las políticas abre un hueco de
// acceso, y nadie se enteraría.
//
// Son DOS guardarraíles con una sola declaración:
//   - el `Record<Enums<"rol_usuario">, true>` obliga al COMPILADOR a exigir que
//     estén los cuatro (si aparece un quinto rol, `tsc` falla con TS2741);
//   - el `expect` de abajo compara contra el array que el generador emite en
//     tiempo de EJECUCIÓN.
// Un rol nuevo rompe los dos a la vez.
const ROLES_DEL_DOMINIO: Record<Enums<"rol_usuario">, true> = {
  admin: true,
  supervisor: true,
  mercaderista: true,
  cliente: true,
};

describe("Constants.public.Enums.rol_usuario", () => {
  it("expone exactamente los cuatro roles del dominio", () => {
    expect([...Constants.public.Enums.rol_usuario].sort()).toEqual(
      Object.keys(ROLES_DEL_DOMINIO).sort(),
    );
  });
});
