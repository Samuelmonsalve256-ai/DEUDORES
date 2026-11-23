-- ════════════════════════════════════════════════════════════════════════════
-- Mis Deudores · deudores-2.sql
--
--  1. Permite guardar en la nube los perfiles de clientes y tus ajustes.
--  2. Crea la carpeta privada para las fotos de los comprobantes.
--  3. Crea las tablas de las notificaciones (dispositivos y claves).
--
--  • NO borra ni modifica ningun dato existente.
--  • Se puede ejecutar mas de una vez sin problema.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Colecciones permitidas: SUMA las de Mis Deudores a las que ya existan ──
-- Lee la regla actual de mc_registros y solo le agrega lo que falte. Nunca quita
-- colecciones de MotoContable (ni las que se agreguen en el futuro). Si la tabla no
-- tiene regla, no hace nada (sin regla, todo esta permitido).
do $$
declare
  actual  text;
  valores text[];
  nuevos  text[] := array['deudores','deudores_clientes','deudores_ajustes'];
  faltan  text[];
begin
  select pg_get_constraintdef(oid) into actual from pg_constraint
   where conname = 'mc_registros_coleccion_check' and conrelid = 'public.mc_registros'::regclass;
  if actual is null then return; end if;
  valores := array(select (regexp_matches(actual, '''([^'']+)''', 'g'))[1]);
  faltan  := array(select x from unnest(nuevos) x where not (x = any(valores)));
  if cardinality(faltan) = 0 then return; end if;
  execute 'alter table public.mc_registros drop constraint mc_registros_coleccion_check';
  execute 'alter table public.mc_registros add constraint mc_registros_coleccion_check check (coleccion in (' ||
          (select string_agg(quote_literal(x), ',') from unnest(valores || faltan) x) || '))';
end $$;

-- ── 2. Fotos de comprobantes: carpeta privada, cada usuario solo ve las suyas ─
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deudores-comprobantes', 'deudores-comprobantes', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists "dd comprobantes: ver"      on storage.objects;
drop policy if exists "dd comprobantes: subir"    on storage.objects;
drop policy if exists "dd comprobantes: cambiar"  on storage.objects;
drop policy if exists "dd comprobantes: borrar"   on storage.objects;

create policy "dd comprobantes: ver" on storage.objects for select to authenticated
  using (bucket_id = 'deudores-comprobantes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dd comprobantes: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'deudores-comprobantes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dd comprobantes: cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'deudores-comprobantes' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'deudores-comprobantes' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dd comprobantes: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'deudores-comprobantes' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 3. Notificaciones ─────────────────────────────────────────────────────────
-- Dispositivos donde activaste los avisos (uno por iPhone / navegador)
create table if not exists public.dd_push_suscripciones (
  endpoint     text primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh       text not null,
  auth         text not null,
  dispositivo  text,
  creado       timestamptz not null default now(),
  ultimo_envio timestamptz
);
alter table public.dd_push_suscripciones enable row level security;
revoke all on table public.dd_push_suscripciones from public, anon, authenticated;
grant select, insert, update, delete on table public.dd_push_suscripciones to authenticated;
drop policy if exists "dd push: mis dispositivos" on public.dd_push_suscripciones;
create policy "dd push: mis dispositivos" on public.dd_push_suscripciones for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Claves del servidor de avisos (privadas: solo la funcion de Supabase las lee)
create table if not exists public.dd_push_config (
  id            int primary key default 1 check (id = 1),
  vapid_publica text,
  vapid_privada jsonb,
  secreto_cron  text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.dd_push_config enable row level security;
revoke all on table public.dd_push_config from public, anon, authenticated;
insert into public.dd_push_config (id) values (1) on conflict (id) do nothing;

-- Registro de envios: evita mandar el mismo aviso dos veces el mismo dia
create table if not exists public.dd_push_envios (
  user_id uuid not null references auth.users(id) on delete cascade,
  fecha   date not null,
  tipo    text not null,
  primary key (user_id, fecha, tipo)
);
alter table public.dd_push_envios enable row level security;
revoke all on table public.dd_push_envios from public, anon, authenticated;

-- Verificacion: debe mostrar las colecciones (con las de Mis Deudores), la carpeta y las 3 tablas
select 'colecciones' as que, pg_get_constraintdef(oid) as detalle from pg_constraint where conname = 'mc_registros_coleccion_check'
union all select 'carpeta', id from storage.buckets where id = 'deudores-comprobantes'
union all select 'tabla', table_name from information_schema.tables where table_schema = 'public' and table_name like 'dd_push_%';
