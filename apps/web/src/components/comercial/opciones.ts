// Las opciones de catálogo que alimentan los formularios comerciales.
//
// Llevan `tenant_id` porque de ahí sale el cliente de la fila que se escribe:
// un selector de cliente aparte podría no coincidir con el de la entidad
// elegida, y la FK compuesta rechazaría la escritura con un error que no le
// dice nada al operador. SKU y tienda ya no se precargan — van por el buscador
// (`components/panel/buscador-opcion.tsx`).

export type OpcionCadena = {
  id: string;
  nombre: string;
  tenant_id: string;
};

export type OpcionMarca = {
  id: string;
  nombre: string;
  tenant_id: string;
};

/** El estado vacío de los formularios: sin catálogo no hay nada que precisar. */
export const SIN_CATALOGO = {
  clase:
    "rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground",
  precio:
    "Un precio necesita un SKU y una cadena, y este cliente aún no tiene cadenas. El catálogo entra por la importación del Excel del cliente.",
  exhibicion:
    "Una exhibición la negocia una marca, y este cliente aún no tiene marcas en el catálogo.",
} as const;
