"use client";

import type { RolUsuario } from "@market-track/shared";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { crearUsuario } from "@/lib/usuarios/acciones";

type Opcion = { id: string; nombre: string };

const ROLES: { value: RolUsuario; label: string }[] = [
  { value: "mercaderista", label: "Mercaderista" },
  { value: "supervisor", label: "Supervisor" },
  { value: "cliente", label: "Cliente (portal)" },
  { value: "admin", label: "Administrador" },
];

const campo =
  "h-[38px] w-full rounded-[9px] border border-border bg-background px-3 text-[13px]";
const etiqueta = "text-[12.5px] font-semibold";

export function FormNuevoUsuario({
  tenants,
  supervisores,
}: {
  tenants: Opcion[];
  supervisores: Opcion[];
}) {
  const [rol, setRol] = useState<RolUsuario>("mercaderista");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  const necesitaTenant = rol === "cliente" || rol === "mercaderista";
  const necesitaSupervisor = rol === "mercaderista";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = fd.get(k);
      return typeof v === "string" ? v.trim() : "";
    };
    const r = await crearUsuario({
      email: s("email"),
      password: s("password"),
      nombre: s("nombre"),
      dni: s("dni"),
      rol,
      telefono: s("telefono") || undefined,
      tenant_id: necesitaTenant ? s("tenant_id") : "",
      supervisor_id: necesitaSupervisor ? s("supervisor_id") : "",
    });
    setEnviando(false);
    if (r.ok) {
      router.push("/admin/usuarios");
      router.refresh();
    } else {
      setError(r.error);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-border bg-background p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Nombre</span>
          <input name="nombre" required className={campo} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Rol</span>
          <select
            name="rol"
            value={rol}
            onChange={(e) => setRol(e.target.value as RolUsuario)}
            className={campo}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Correo</span>
          <input name="email" type="email" required className={campo} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Contraseña inicial</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={campo}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>DNI</span>
          <input name="dni" required className={campo} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={etiqueta}>Teléfono</span>
          <input name="telefono" className={campo} />
        </label>

        {necesitaTenant && (
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Cliente-marca</span>
            <select name="tenant_id" required className={campo}>
              <option value="">Selecciona…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </label>
        )}

        {necesitaSupervisor && (
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Supervisor</span>
            <select name="supervisor_id" required className={campo}>
              <option value="">Selecciona…</option>
              {supervisores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-alerta">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/admin/usuarios")}
          className="rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={enviando}
          className="rounded-md bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {enviando ? "Creando…" : "Crear usuario"}
        </button>
      </div>
    </form>
  );
}
