-- ════════════════════════════════════════════════════════════════════════════
-- Mis Deudores · deudores.sql
-- Permite guardar Mis Deudores en la nube, en la misma tabla mc_registros de
-- MotoContable, con la misma seguridad (RLS), el mismo historial y las mismas
-- funciones de sincronización.
--
--  • Solo amplía la lista de colecciones permitidas con 'deudores'.
--  • NO borra ni modifica ningún dato. Los registros existentes siguen cumpliendo
--    la regla nueva.
--  • Se puede ejecutar más de una vez sin problema.
--  • Es el mismo contenido que supabase/07_deudores.sql del repositorio Motocontable.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.mc_registros
  drop constraint if exists mc_registros_coleccion_check;

alter table public.mc_registros
  add constraint mc_registros_coleccion_check check (coleccion in
    ('motos','movimientos','ventas','carros','contactos','metas','config',
     'traspasos','traspasos_borradores','deudores'));

commit;

-- Verificación: debe mostrar la regla nueva con las 10 colecciones.
select pg_get_constraintdef(oid) as regla
from pg_constraint
where conname = 'mc_registros_coleccion_check';
