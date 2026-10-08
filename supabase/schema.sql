-- ============================================================
-- Portal de Residentes — California Residencial
-- Esquema de base de datos para Supabase (Postgres + Auth)
-- ============================================================
-- Cómo usarlo: copia todo este archivo y pégalo en
-- Supabase > SQL Editor > New query, y presiona "Run".
-- ============================================================

-- Extensión necesaria para generar UUIDs
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tabla: residentes
-- Un registro por residente, ligado 1 a 1 con auth.users (el
-- sistema de login de Supabase). Aquí vive el padrón completo:
-- quién es propietario, quién renta y quién tiene una posesión
-- irregular del lote.
-- ------------------------------------------------------------
create table public.residentes (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  domicilio text not null,              -- ej. "Lote 14, Cerrada Córdoba"
  tipo_ocupacion text not null default 'propietario'
    check (tipo_ocupacion in ('propietario', 'arrendatario', 'posesion_irregular')),
  telefono text,
  rol text not null default 'residente'
    check (rol in ('residente', 'comite')),
  creado_en timestamptz not null default now()
);

comment on table public.residentes is 'Padrón de residentes de la colonia, ligado a la cuenta de login de cada quien.';
comment on column public.residentes.tipo_ocupacion is 'propietario | arrendatario | posesion_irregular. Este campo solo lo debe ver y editar el comité.';
comment on column public.residentes.rol is 'residente: acceso normal. comite: acceso a todo el padrón y todas las visitas.';

-- ------------------------------------------------------------
-- Tabla: visitas
-- Bitácora de entradas/salidas de visitantes, ligada al
-- residente/domicilio que autoriza o recibe la visita.
-- ------------------------------------------------------------
create table public.visitas (
  id uuid primary key default gen_random_uuid(),
  residente_id uuid not null references public.residentes(id) on delete cascade,
  visitante_nombre text not null,
  vehiculo_placas text,
  motivo text,
  entrada timestamptz not null default now(),
  salida timestamptz,
  registrado_por uuid references public.residentes(id),
  creado_en timestamptz not null default now()
);

comment on table public.visitas is 'Registro de entradas y salidas de visitantes por domicilio.';

create index idx_visitas_residente on public.visitas (residente_id);
create index idx_visitas_entrada on public.visitas (entrada desc);

-- ------------------------------------------------------------
-- Row Level Security: cada residente solo ve/edita lo suyo;
-- el comité ve y edita todo.
-- ------------------------------------------------------------
alter table public.residentes enable row level security;
alter table public.visitas enable row level security;

-- residentes: lectura
create policy "residentes_select"
on public.residentes for select
using (
  auth.uid() = id
  or exists (select 1 from public.residentes r where r.id = auth.uid() and r.rol = 'comite')
);

-- residentes: actualización (el propio residente puede editar su teléfono/nombre;
-- el comité puede editar cualquier campo, incluyendo tipo_ocupacion y rol)
create policy "residentes_update"
on public.residentes for update
using (
  auth.uid() = id
  or exists (select 1 from public.residentes r where r.id = auth.uid() and r.rol = 'comite')
);

-- residentes: alta manual desde el panel del comité (el alta normal por
-- registro público ocurre automáticamente vía el trigger de abajo)
create policy "residentes_insert"
on public.residentes for insert
with check (
  auth.uid() = id
  or exists (select 1 from public.residentes r where r.id = auth.uid() and r.rol = 'comite')
);

-- visitas: lectura (el residente ve solo sus visitas; el comité ve todas)
create policy "visitas_select"
on public.visitas for select
using (
  residente_id = auth.uid()
  or exists (select 1 from public.residentes r where r.id = auth.uid() and r.rol = 'comite')
);

-- visitas: alta (el residente registra visitas para su propio domicilio;
-- el comité puede registrar para cualquier domicilio)
create policy "visitas_insert"
on public.visitas for insert
with check (
  residente_id = auth.uid()
  or exists (select 1 from public.residentes r where r.id = auth.uid() and r.rol = 'comite')
);

-- visitas: actualización (ej. registrar hora de salida)
create policy "visitas_update"
on public.visitas for update
using (
  residente_id = auth.uid()
  or exists (select 1 from public.residentes r where r.id = auth.uid() and r.rol = 'comite')
);

-- ------------------------------------------------------------
-- Trigger: cuando alguien se registra (signup), se crea
-- automáticamente su fila en "residentes" con los datos que
-- mandó el formulario de registro.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.residentes (id, nombre_completo, domicilio, tipo_ocupacion, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre_completo', ''),
    coalesce(new.raw_user_meta_data->>'domicilio', ''),
    coalesce(new.raw_user_meta_data->>'tipo_ocupacion', 'propietario'),
    'residente'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- IMPORTANTE — primer usuario del comité:
-- Todo usuario nuevo nace con rol = 'residente'. Para que tú
-- (el primer administrador) tengas acceso de comité, regístrate
-- normalmente en la app y luego corre esto UNA VEZ, cambiando
-- el correo por el tuyo:
--
--   update public.residentes set rol = 'comite'
--   where id = (select id from auth.users where email = 'tu_correo@ejemplo.com');
--
-- Desde ahí, tú mismo puedes ascender a otros miembros del
-- comité editando su fila en la tabla "residentes" (columna rol).
-- ------------------------------------------------------------
