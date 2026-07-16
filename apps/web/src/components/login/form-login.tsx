"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

// El acceso al panel en tres pasos (ADR-0008): contraseña → factor → código.
//
// El factor de Supabase es de tipo "Teléfono", pero el código llega por CORREO:
// lo enruta el hook `send_sms`. Por eso pedimos el teléfono al enrolar aunque el
// medio sea el correo — es lo que el factor nativo exige para existir.
//
// Sin completar el segundo factor la sesión se queda en `aal1`, y con `aal1` no se
// ve el panel (middleware) ni se leen datos (RLS): el 2FA no es opcional.

type Paso = "credenciales" | "telefono" | "codigo";

const campo =
  "h-[38px] w-full rounded-[9px] border border-border bg-background px-3 text-[13px]";
const etiqueta = "text-[12.5px] font-semibold";
const boton =
  "h-[38px] w-full rounded-[9px] bg-primary text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";

/** Un campo de texto del form; nunca un File, que es lo otro que puede venir. */
function leerCampo(fd: FormData, clave: string): string {
  const v = fd.get(clave);
  return typeof v === "string" ? v.trim() : "";
}

export function FormLogin({
  destino,
  empiezaEn2fa,
}: {
  destino: string;
  empiezaEn2fa: boolean;
}) {
  const [paso, setPaso] = useState<Paso>("credenciales");
  const [cargando, setCargando] = useState(empiezaEn2fa);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const router = useRouter();
  const [supabase] = useState(() => createBrowserSupabaseClient());

  /** Pide el código a Supabase; el hook lo entrega por el canal del usuario. */
  const pedirCodigo = useCallback(
    async (fid: string) => {
      setFactorId(fid);
      const { data, error: e } = await supabase.auth.mfa.challenge({
        factorId: fid,
      });
      if (e || !data) {
        setError("No pudimos enviarte el código. Inténtalo de nuevo.");
        return;
      }
      setChallengeId(data.id);
      setPaso("codigo");
    },
    [supabase],
  );

  /** ¿Ya tiene factor? Entonces al código; si no, hay que enrolarlo primero. */
  const continuar2fa = useCallback(async () => {
    const { data, error: e } = await supabase.auth.mfa.listFactors();
    if (e || !data) {
      setError("No pudimos comprobar tu segundo factor.");
      return;
    }
    const telefonicos = data.all.filter((f) => f.factor_type === "phone");
    // Un enrolamiento a medias (de un intento anterior) se reutiliza en vez de
    // crear un factor duplicado.
    const usable =
      telefonicos.find((f) => f.status === "verified") ?? telefonicos[0];
    if (!usable) {
      setPaso("telefono");
      return;
    }
    await pedirCodigo(usable.id);
  }, [supabase, pedirCodigo]);

  useEffect(() => {
    if (!empiezaEn2fa) return;
    void (async () => {
      await continuar2fa();
      setCargando(false);
    })();
  }, [empiezaEn2fa, continuar2fa]);

  async function alEntrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: leerCampo(fd, "email"),
      password: leerCampo(fd, "password"),
    });
    if (err) {
      // Mensaje único a propósito: no se le dice a nadie si el correo existe.
      setError("Correo o contraseña incorrectos.");
      setEnviando(false);
      return;
    }
    await continuar2fa();
    setEnviando(false);
  }

  async function alEnrolar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: "phone",
      phone: leerCampo(fd, "telefono"),
    });
    if (err || !data) {
      setError("No pudimos registrar ese número. Revisa el formato (+51…).");
      setEnviando(false);
      return;
    }
    await pedirCodigo(data.id);
    setEnviando(false);
  }

  async function alVerificar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!factorId || !challengeId) return;
    setEnviando(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const { error: err } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: leerCampo(fd, "codigo"),
    });
    if (err) {
      setError("El código no es válido o ya venció.");
      setEnviando(false);
      return;
    }
    // La sesión ya es aal2: el middleware y la RLS la dejan pasar.
    router.push(destino);
    router.refresh();
  }

  async function reenviar() {
    if (!factorId) return;
    setError(null);
    setAviso(null);
    await pedirCodigo(factorId);
    setAviso("Te enviamos un código nuevo.");
  }

  if (cargando) {
    return <p className="text-[13px] text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-6">
      {paso === "credenciales" && (
        <form
          onSubmit={(e) => void alEntrar(e)}
          className="flex flex-col gap-4"
        >
          <h1 className="text-lg font-bold">Iniciar sesión</h1>
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Correo</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Contraseña</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={campo}
            />
          </label>
          <button type="submit" disabled={enviando} className={boton}>
            {enviando ? "Entrando…" : "Continuar"}
          </button>
        </form>
      )}

      {paso === "telefono" && (
        <form
          onSubmit={(e) => void alEnrolar(e)}
          className="flex flex-col gap-4"
        >
          <div>
            <h1 className="text-lg font-bold">Activa tu segundo factor</h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Necesitamos tu número para activar el segundo factor. El código te
              llegará por correo.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Teléfono</span>
            <input
              name="telefono"
              type="tel"
              required
              placeholder="+51999888777"
              autoComplete="tel"
              className={campo}
            />
          </label>
          <button type="submit" disabled={enviando} className={boton}>
            {enviando ? "Registrando…" : "Enviarme el código"}
          </button>
        </form>
      )}

      {paso === "codigo" && (
        <form
          onSubmit={(e) => void alVerificar(e)}
          className="flex flex-col gap-4"
        >
          <div>
            <h1 className="text-lg font-bold">Revisa tu correo</h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Te enviamos un código de 6 dígitos.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={etiqueta}>Código</span>
            <input
              name="codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className={`${campo} font-mono tracking-[4px]`}
            />
          </label>
          <button type="submit" disabled={enviando} className={boton}>
            {enviando ? "Verificando…" : "Entrar"}
          </button>
          <button
            type="button"
            onClick={() => void reenviar()}
            className="text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
          >
            Reenviar código
          </button>
        </form>
      )}

      {aviso && (
        <p role="status" className="text-[12.5px] text-muted-foreground">
          {aviso}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-alerta">
          {error}
        </p>
      )}
    </div>
  );
}
