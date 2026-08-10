// Las opciones de catálogo que alimentan los tres formularios comerciales.
//
// Todas llevan `tenant_id` porque de ahí sale el cliente de la fila que se
// escribe: un selector de cliente aparte podría no coincidir con el del SKU o la
// tienda, y la FK compuesta rechazaría la escritura con un error que no le dice
// nada al operador.

export type OpcionSku = {
  id: string;
  codigo: string;
  nombre: string;
  tenant_id: string;
  cliente: string;
};

export type OpcionCadena = {
  id: string;
  nombre: string;
  tenant_id: string;
};

export type OpcionTienda = {
  id: string;
  nombre: string;
  tenant_id: string;
  cliente: string;
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
    "Un precio necesita un SKU y una cadena, y todavía falta alguno de los dos. El catálogo entra por la importación del Excel del cliente.",
  promocion:
    "Una promoción necesita un SKU y todavía no hay ninguno. El catálogo entra por la importación del Excel del cliente.",
  exhibicion:
    "Una exhibición se negocia para una tienda y una marca, y todavía falta alguna de las dos.",
} as const;
