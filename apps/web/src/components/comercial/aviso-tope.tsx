import { TOPE_LISTADO } from "@/lib/comercial/listado";

// Cuando el listado se recorta, se dice.
//
// Un corte silencioso es peor que el corte: quien mira la tabla concluye que eso
// es todo lo que hay y da por buena una cuenta que no cuadra.

export function AvisoTope({ hayMas }: { hayMas: boolean }) {
  if (!hayMas) return null;

  return (
    <p className="text-[12px] text-muted-foreground">
      Se muestran las {TOPE_LISTADO} más recientes. Hay más: el listado todavía
      no tiene paginación.
    </p>
  );
}
