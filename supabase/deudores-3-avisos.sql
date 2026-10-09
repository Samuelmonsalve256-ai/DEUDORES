-- ════════════════════════════════════════════════════════════════════════════
-- Mis Deudores · deudores-3-avisos.sql
-- Programa la revision de avisos: cada hora Supabase llama a la funcion
-- "deudores-avisos"; la funcion solo envia a la hora que elegiste en Ajustes
-- (y una sola vez por dia).
--
--  Ejecutar DESPUES de crear la funcion "deudores-avisos" (ver README).
--  Se puede ejecutar mas de una vez: reemplaza la programacion anterior.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'deudores-avisos') then
    perform cron.unschedule('deudores-avisos');
  end if;
end
$$;

select cron.schedule(
  'deudores-avisos',
  '2 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://llyovzgwdqoeunvyczcy.supabase.co/functions/v1/deudores-avisos',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxseW92emd3ZHFvZXVudnljemN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MzUzNjcsImV4cCI6MjEwNjAxMTM2N30.g1DgUdTGPHDz8HEI1Kgv4SOJ13zyOwOfcAp8Ak2BRGQ',
      'x-dd-cron',     (select secreto_cron from public.dd_push_config where id = 1)
    ),
    body    := '{"accion":"diario"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

-- Verificacion: debe mostrar la tarea "deudores-avisos" activa
select jobname, schedule, active from cron.job where jobname = 'deudores-avisos';
