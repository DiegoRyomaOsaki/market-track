// Next transforma los imports globales de CSS en el build; `tsc` necesita saber
// que un import de efecto secundario de un `.css` es válido. Sin esto, el
// typecheck falla con TS2882 salvo que Next haya generado antes `next-env.d.ts`
// (que no existe en un CI que solo corre `tsc`, no `next build`).
declare module "*.css";
