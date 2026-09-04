-- Enciende el segundo factor en la RLS (ADR-0008, punto 4).
--
-- Hasta ahora el gate `aal2` vivía SOLO en el middleware de Next.js, y eso protege
-- la UI, no los datos: una sesión `aal1` que hablara directo con PostgREST seguía
-- leyendo lo que su RLS le permitiera. Aquí se cierra.
--
-- Va dentro de `app.perfil_efectivo()` a propósito: es el ÚNICO dueño de la regla
-- de acceso derivada, así que una sola línea cubre todas las políticas que ya
-- cuelgan de ella (es_staff, rol_actual, tenant_actual) sin tocarlas una por una
-- ni abrir un segundo camino de enforcement.
--
-- `aal` es un claim NATIVO que emite el propio Auth al verificar el factor: no es
-- una copia rancia que mantengamos nosotros (por eso sí se lee del JWT, a
-- diferencia del rol y el tenant_id, que se recalculan aquí en cada consulta).
--
-- OJO al encenderlo: a partir de esta migración, una sesión sin `aal2` no ve NADA.
-- Por eso viaja junto con la pantalla de login que enrola el factor y completa el
-- segundo factor — antes de ella, esto dejaría a todo el mundo fuera.
create or replace function app.perfil_efectivo()
returns table (id uuid, rol public.rol_usuario, tenant_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.rol, p.tenant_id
  from public.profile p
  left join public.tenant t on t.id = p.tenant_id
  where p.id = (select auth.uid())
    and p.activo                                    -- la persona sigue trabajando aquí
    and (p.tenant_id is null or t.activo)           -- y su cliente sigue siendo cliente
    and (select auth.jwt() ->> 'aal') = 'aal2';     -- y completó el segundo factor
$$;

comment on function app.perfil_efectivo() is
  'ÚNICO dueño de la regla de acceso derivada: usuario activo, cliente activo y sesión con segundo factor (aal2). Devuelve 0 filas si algo de eso falla: todo lo demás falla cerrado a partir de ahí.';
