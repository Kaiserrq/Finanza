-- =============================================================
--  Finanza: tabla para sincronizar datos entre dispositivos
--  Cópialo completo en Supabase → SQL Editor → New query → Run
-- =============================================================

-- Una fila por usuario con todos sus datos (movimientos, categorías, presupuestos).
create table if not exists public.finanza_data (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Seguridad (RLS): cada persona solo puede leer y modificar SU propia fila.
-- Sin esto, cualquiera con la clave pública podría ver los datos de otros.
alter table public.finanza_data enable row level security;

drop policy if exists "Ver mis datos"       on public.finanza_data;
drop policy if exists "Crear mis datos"     on public.finanza_data;
drop policy if exists "Actualizar mis datos" on public.finanza_data;
drop policy if exists "Borrar mis datos"    on public.finanza_data;

create policy "Ver mis datos" on public.finanza_data
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Crear mis datos" on public.finanza_data
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Actualizar mis datos" on public.finanza_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Borrar mis datos" on public.finanza_data
  for delete to authenticated using ((select auth.uid()) = user_id);
