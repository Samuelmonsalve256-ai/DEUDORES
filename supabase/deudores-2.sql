-- ════════════════════════════════════════════════════════════════════════════
-- Mis Deudores · deudores-2.sql  (ejecutar UNA vez, despues de deudores.sql)
--
--  1. Permite guardar en la nube los perfiles de clientes y tus ajustes.
--  2. Crea la carpeta privada para las fotos de los comprobantes.
--  3. Crea las tablas de las notificaciones (dispositivos y claves).
--
--  • NO borra ni modifica ningun dato existente.
--  • Se puede ejecutar mas de una vez sin problema.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Colecciones permitidas (MotoContable + Traspasos + Mis Deudores) ──────
begin;
alter table public.mc_registros drop constraint if exists mc_registros_coleccion_check;
alter table public.mc_registros add constraint mc_registros_coleccion_check check (coleccion in
  ('motos','movimientos','ventas','carros','contactos','metas','config',
   'traspasos','traspasos_borradores',
   'deudores','deudores_clientes','deudores_ajustes'));
commit;

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

-- Verificacion: debe mostrar las 12 colecciones, la carpeta y las 3 tablas
select 'colecciones' as que, pg_get_constraintdef(oid) as detalle from pg_constraint where conname = 'mc_registros_coleccion_check'
union all select 'carpeta', id from storage.buckets where id = 'deudores-comprobantes'
union all select 'tabla', table_name from information_schema.tables where table_schema = 'public' and table_name like 'dd_push_%';
