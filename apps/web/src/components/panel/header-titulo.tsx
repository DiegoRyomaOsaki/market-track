"use client";

import { usePathname } from "next/navigation";

import { itemActivo } from "@/lib/panel/navegacion";

export function HeaderTitulo() {
  const item = itemActivo(usePathname());
  return (
    <div className="min-w-0 flex-1">
      <h1 className="text-base font-bold tracking-tight">
        {item?.titulo ?? "Panel"}
      </h1>
      {item?.subtitulo && (
        <div className="truncate text-[11.5px] text-muted-foreground">
          {item.subtitulo}
        </div>
      )}
    </div>
  );
}
