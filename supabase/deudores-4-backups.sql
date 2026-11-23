-- ════════════════════════════════════════════════════════════════════════════
-- Mis Deudores · deudores-4-backups.sql
-- Carpeta privada para el backup automatico (cada 15 dias, los 6 ultimos).
--  • Cada usuario solo ve, descarga y borra sus propios backups.
--  • NO borra ni modifica ningun dato. Se puede ejecutar mas de una vez.
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deudores-backups', 'deudores-backups', false, 20971520, array['application/json'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "dd backups: ver"     on storage.objects;
drop policy if exists "dd backups: subir"   on storage.objects;
drop policy if exists "dd backups: cambiar" on storage.objects;
drop policy if exists "dd backups: borrar"  on storage.objects;

create policy "dd backups: ver" on storage.objects for select to authenticated
  using (bucket_id = 'deudores-backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dd backups: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'deudores-backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dd backups: cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'deudores-backups' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'deudores-backups' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "dd backups: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'deudores-backups' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Verificacion: debe mostrar la carpeta y sus 4 reglas
select 'carpeta' as que, id as detalle from storage.buckets where id = 'deudores-backups'
union all
select 'regla', policyname from pg_policies where tablename = 'objects' and policyname like 'dd backups:%';
