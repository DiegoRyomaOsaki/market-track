// Extiende `expect` con los matchers de DOM (`toBeInTheDocument`, …) y sus tipos.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library solo engancha su limpieza automática cuando Vitest corre con
// `globals: true`, y aquí no. Sin esto cada `render` deja su árbol en el
// documento y el segundo test de un mismo archivo falla con "found multiple
// elements" — un fallo que solo aparece cuando un componente pasa a tener más de
// un caso, o sea justo cuando empieza a estar bien probado.
afterEach(cleanup);
