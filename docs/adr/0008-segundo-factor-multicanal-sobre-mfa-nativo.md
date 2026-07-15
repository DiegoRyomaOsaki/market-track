# ADR-0008 — Segundo factor multicanal sobre el MFA nativo de Supabase

- **Estado:** **propuesto** — la investigación del spike está hecha y confirma
  que el requisito se cubre sin salir de Supabase; falta la **implementación que
  lo valide** (ver "Lo que la implementación todavía debe probar").
- **Fecha:** 2026-07-14
- **Reemplaza a:** —

## Contexto

La propuesta aceptada fija el segundo factor como alcance ✅ de Fase 1
(`docs/04`): **contraseña + segundo factor por correo (canal por defecto)**, con
**SMS y WhatsApp** como canales adicionales habilitables/deshabilitables desde el
panel, más un **pase de acceso temporal** para el usuario que no recibe su OTP.
El propio `docs/04` deja la forma exacta "por validar en el spike de segundo
factor" — este ADR es ese spike.

Restricción del dueño del proyecto: **quedarse dentro de Supabase**, usando sus
propias piezas siempre que se pueda, antes que montar un sistema de auth propio.

Dos hechos técnicos, verificados contra la documentación viva de Supabase el
2026-07-14, enmarcan la decisión:

1. **El MFA nativo de Supabase reconoce dos tipos de factor: App Authenticator
   (TOTP) y Teléfono.** No existe un factor "email". Al verificar un factor, el
   JWT recibe el claim nativo `aal: "aal2"` — la señal que el servidor puede
   exigir. (`/docs/guides/auth/auth-mfa`.)
2. **El factor Teléfono entrega el código por SMS *o WhatsApp*, y su entrega se
   puede reescribir con el `Send SMS Hook`.** El hook recibe el usuario y el
   código y decide cómo mandarlo — puede ser una función Postgres o un HTTP hook
   hacia una Edge Function. La documentación incluye el caso explícito "usar
   WhatsApp" enrutando `whatsapp:${numero}` por Twilio.
   (`/docs/guides/auth/auth-mfa/phone`, `/docs/guides/auth/auth-hooks/send-sms-hook`.)

Y un hecho del repo, del que sale la urgencia: hoy **no hay ningún enforcement**.
`supabase/config.toml` tiene las tres secciones MFA (`totp`, `phone`,
`web_authn`) deshabilitadas, así que tras el login por contraseña la sesión ya
tiene acceso total. La auditoría de fundaciones lo marcó como alta: MAR-15 y
MAR-16 no pueden construir sus pantallas de login sin cerrar esta decisión,
porque de ella dependen qué llamadas hace el cliente, qué guarda la sesión y qué
exige el middleware y la RLS.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **A — Un factor Teléfono nativo por usuario; el `Send SMS Hook` enruta la entrega según el canal elegido (correo por defecto · SMS · WhatsApp)** | **`aal2` nativo**: enforcement gratis en RLS y middleware. Supabase gestiona challenge/verify, un solo uso y expiración. Un único mecanismo cubre los tres canales. El punto de extensión (el hook) es oficial de Supabase. | El correo se entrega a través de un factor que GoTrue llama internamente "teléfono": rareza semántica invisible para el usuario. Exige un teléfono en el alta (ya se necesita para SMS/WhatsApp, y es una app de campo: todos lo tienen). |
| B — Flujo de email propio con `Custom Access Token Hook` que inyecta un claim `mfa_ok` | Semántica limpia: el correo es correo. | Reimplementa a mano lo que el MFA nativo da gratis: un solo uso, expiración, refresco del token. Más código, más superficie de bugs, y un claim que hay que recalcular para que no quede rancio. Contradice "quedarse en Supabase". |
| C — TOTP nativo (App Authenticator) como segundo factor | Cero infraestructura de envío; es el MFA más robusto. | El **correo es el canal por defecto que fija la propuesta**, no una app. El usuario es un mercaderista de campo con gama media: no va a instalar ni configurar un Authenticator. No cumple el requisito. |
| D — Interruptor de "sin 2FA" por usuario para quien no recibe el OTP | Trivial. | **Prohibido por CLAUDE.md**: un interruptor así se queda encendido para siempre y se vuelve una puerta abierta permanente. El pase de acceso temporal (un solo uso, 15 min, auditado) es la respuesta correcta a ese caso, y ya está en el alcance. |

## Decisión

**Se enrola un único factor Teléfono nativo de Supabase por usuario, y el
`Send SMS Hook` — como HTTP hook hacia una Edge Function — entrega el OTP por el
canal que el usuario tenga configurado: correo por defecto (Resend, ya en el
stack), o SMS/WhatsApp (Twilio) si el panel los habilitó.** El enforcement es el
claim nativo `aal: aal2`: middleware de Next.js y políticas RLS exigen `aal2`
para todo lo protegido. El **pase de acceso temporal** es el único bypass, y al
canjearse produce una sesión ya elevada a `aal2` desde el servidor
(`service_role`), para que el gate del servidor siga siendo uno solo.

Reparto de responsabilidades en el modelo (a concretar en migración, fuera de
este ADR):

- **Qué canales están permitidos es una política GLOBAL de la outsourcing**, no
  por cliente: vive en `configuracion_plataforma.otp_canales_habilitados` (fila
  única, sin `tenant_id`, ya en el esquema). Tiene que ser global porque el staff
  (admin/supervisor) no pertenece a ningún cliente — una config por tenant no lo
  gobernaría. El panel la togglea.
- `profile` ya tiene `telefono` y `telefono_verificado_at`. **Cuál canal usa cada
  usuario** (entre los globalmente habilitados) es una elección menor todavía
  abierta: o un `profile.canal_2fa` persistido (default `correo`), o simplemente
  `correo` por defecto con "recibirlo por otro medio" resuelto en tiempo de login.
  Se decide al implementar, según qué necesite el hook para enrutar.

## Consecuencias

**Lo que ganamos.** El enforcement es nativo y no se puede olvidar: un token sin
`aal2` no pasa el middleware ni la RLS, sin código propio que mantener. Un solo
mecanismo (un factor, un hook) sirve los tres canales; añadir WhatsApp en su fase
es cambiar el enrutado del hook, no un sistema nuevo. Todo el ciclo de vida del
factor —challenge, verify, un solo uso, expiración— lo lleva Supabase.

**Lo que aceptamos a cambio.** (1) El correo, que es el canal por defecto y el
más usado, viaja por un factor que internamente es "teléfono": es una rareza que
el usuario nunca ve pero que quien lea el código debe conocer, y por eso queda
escrita aquí. (2) El alta exige un teléfono aunque el canal sea correo — asumible
porque los otros dos canales ya lo exigen y es una app de campo. (3) SMS y
WhatsApp arrastran un proveedor externo (Twilio) y coste por mensaje; entran en
su fase, no en el primer login, que es solo correo. (4) El pase temporal tiene
que elevar a `aal2` desde `service_role` al canjearse; si esa pieza no se
resuelve bien, el gate del servidor se bifurca y aparece un segundo camino de
enforcement — justo lo que esta decisión evita.

**Cómo lo sabríamos si nos equivocamos.** Si al implementar resulta que el
`Send SMS Hook` no se dispara para los challenges de MFA (solo para el login por
teléfono), o que no deja enrutar a correo, la Opción A se cae y hay que ir a la B
(flujo de email propio con `Custom Access Token Hook`). Esa es la primera cosa
que la implementación debe probar, antes de construir ninguna pantalla.

## Lo que la implementación todavía debe probar

1. ~~**Que el `Send SMS Hook` se dispara en el challenge de MFA (Teléfono)**~~ —
   **CONFIRMADO (2026-07-15, verificado en local).** Con `[auth.mfa.phone]`
   habilitado y un `send_sms` hook (pg-function) apuntado a una sonda: al hacer
   `POST /auth/v1/factors/{id}/challenge` sobre un factor Teléfono, el hook se
   invoca con un payload que trae `sms.sms_type = "mfa"` (distingue MFA del OTP de
   login), el `sms.otp`, y el `user` completo **con su email** — así el hook puede
   entregar por correo o enrutar a SMS/WhatsApp. Devolver `{}` = "entrega manejada
   por el hook". La Opción A queda validada; no hace falta la Opción B.
2. **El canje del pase de acceso temporal elevando a `aal2`** desde una Edge
   Function con `service_role`, sin abrir un segundo camino de enforcement.
3. **La persistencia de la sesión**: `docs/04` fija que el 2FA "no se repite cada
   día". Confirmar el recordado de dispositivo / duración de `aal2` para no pedir
   OTP en cada apertura — clave en una app de campo con conectividad intermitente.
4. **El gate en la RLS**: hoy `app.perfil_efectivo()` no mira `aal`. Decidir si el
   segundo factor se exige en la RLS (leyendo el claim `aal` con el mismo patrón
   `(select ...)`), en el middleware, o en ambos.
