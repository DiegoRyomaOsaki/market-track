-- El canal preferido de 2FA por usuario, entre los globalmente habilitados
-- (`configuracion_plataforma.otp_canales_habilitados`). El correo es el default
-- obligatorio. Lo usa el hook de entrega del OTP para saber por dónde mandarlo.
--
-- Quién lo escribe: el admin desde el panel — la política de escritura de
-- `profile` ya es admin-only. El usuario lo LEE en su propia fila.
--
-- El grant de `profile` a `authenticated` es a nivel de tabla, así que esta
-- columna queda cubierta sin un grant explícito.

alter table public.profile
  add column canal_2fa public.canal_otp not null default 'correo';

comment on column public.profile.canal_2fa is
  'Canal preferido para el OTP de 2FA. La restricción "debe estar entre los habilitados globalmente" la aplican el hook de entrega y el panel, no un CHECK: los canales habilitados cambian y un CHECK los congelaría.';
