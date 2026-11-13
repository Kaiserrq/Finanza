-- =============================================================
--  Finanza: notificaciones de pago con la app cerrada
--  Guía paso a paso: docs/NOTIFICACIONES.md
--  Ejecuta cada PARTE por separado en Supabase → SQL Editor.
-- =============================================================


-- ===================== PARTE 1: tabla de dispositivos =====================
-- Un registro por celular / computador donde activaste las notificaciones.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  timezone   text not null default 'UTC',   -- para avisar a las 9:00 de tu hora local
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Seguridad (RLS): cada persona solo ve y administra sus propios dispositivos.
alter table public.push_subscriptions enable row level security;

drop policy if exists "Ver mis dispositivos"        on public.push_subscriptions;
drop policy if exists "Crear mis dispositivos"      on public.push_subscriptions;
drop policy if exists "Actualizar mis dispositivos" on public.push_subscriptions;
drop policy if exists "Borrar mis dispositivos"     on public.push_subscriptions;

create policy "Ver mis dispositivos" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Crear mis dispositivos" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Actualizar mis dispositivos" on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Borrar mis dispositivos" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);


-- ===================== PARTE 2: ejecutar la función cada hora =====================
-- Antes de ejecutar esta parte, reemplaza  PEGA-AQUI-TU-CRON-SECRET  por el mismo
-- texto que guardaste como secreto CRON_SECRET (paso 4 de la guía).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'finanza-recordatorios',   -- si ya existía, se reemplaza
  '0 * * * *',               -- al minuto 0 de cada hora
  $$
  select net.http_post(
    url     := 'https://ogmlanpqzfnwewmryyub.supabase.co/functions/v1/send-reminders',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "PEGA-AQUI-TU-CRON-SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);


-- ===================== PRUEBAS (opcional) =====================
-- Enviar una notificación de prueba a todos tus dispositivos ahora mismo:
--   select net.http_post(
--     url     := 'https://ogmlanpqzfnwewmryyub.supabase.co/functions/v1/send-reminders?modo=prueba',
--     headers := '{"Content-Type": "application/json", "x-cron-secret": "PEGA-AQUI-TU-CRON-SECRET"}'::jsonb,
--     body    := '{}'::jsonb
--   );
--
-- Ver el resultado de las últimas llamadas (columna content):
--   select id, status_code, content, created from net._http_response order by created desc limit 5;
--
-- Ver si la tarea programada se está ejecutando:
--   select * from cron.job_run_details order by start_time desc limit 5;
--
-- Desactivar los avisos automáticos:
--   select cron.unschedule('finanza-recordatorios');
