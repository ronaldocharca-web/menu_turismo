-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Añade usuarios administrados y permisos por categoría sin ocultar el directorio público.

alter table public.profiles add column if not exists username text;

update public.profiles as profile
set username = case
  when char_length(regexp_replace(lower(split_part(auth_user.email, '@', 1)), '[^a-z0-9._-]+', '', 'g')) >= 3
    then regexp_replace(lower(split_part(auth_user.email, '@', 1)), '[^a-z0-9._-]+', '', 'g')
  else 'user_' || left(profile.id::text, 8)
end
from auth.users as auth_user
where auth_user.id = profile.id and profile.username is null;

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username)) where username is not null;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9._-]{3,32}$');

create table if not exists public.user_category_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

drop policy if exists "Public can read links" on public.links;
drop policy if exists "Active members read links" on public.links;
drop policy if exists "Admins read links" on public.links;
create policy "Admins read links" on public.links for select
using (public.is_admin());

create or replace function public.list_public_links()
returns table (
  id uuid,
  title text,
  display_host text,
  description text,
  category_id uuid,
  category_name text,
  created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    link.id,
    link.title,
    regexp_replace(link.url, '^https?://([^/]+).*$','\1', 'i') as display_host,
    link.description,
    link.category_id,
    category.name as category_name,
    link.created_at
  from public.links as link
  join public.categories as category on category.id = link.category_id
  order by link.created_at desc;
$$;

create or replace function public.get_link_destination(requested_link_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare destination text;
begin
  select link.url into destination
  from public.links as link
  where link.id = requested_link_id
    and (
      public.is_admin()
      or (
        public.is_active_member()
        and exists (
          select 1 from public.user_category_permissions as permission
          where permission.user_id = auth.uid()
            and permission.category_id = link.category_id
        )
      )
    );
  if destination is null then
    raise exception 'Acceso no autorizado' using errcode = '42501';
  end if;
  return destination;
end;
$$;

grant execute on function public.list_public_links() to anon, authenticated;
revoke execute on function public.get_link_destination(uuid) from public, anon;
grant execute on function public.get_link_destination(uuid) to authenticated;

alter table public.user_category_permissions enable row level security;

drop policy if exists "Users read own category permissions" on public.user_category_permissions;
create policy "Users read own category permissions"
on public.user_category_permissions for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Admins manage category permissions" on public.user_category_permissions;
create policy "Admins manage category permissions"
on public.user_category_permissions for all
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Active members create links" on public.links;
drop policy if exists "Owners or admins update links" on public.links;
drop policy if exists "Owners or admins delete links" on public.links;
drop policy if exists "Admins create links" on public.links;
drop policy if exists "Admins update links" on public.links;
drop policy if exists "Admins delete links" on public.links;

create policy "Admins create links" on public.links for insert
with check (public.is_admin() and created_by = auth.uid());
create policy "Admins update links" on public.links for update
using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete links" on public.links for delete
using (public.is_admin());

drop policy if exists "Users edit own name" on public.profiles;
drop policy if exists "Admins activate members" on public.profiles;
drop policy if exists "Admins update users" on public.profiles;
create policy "Admins update users" on public.profiles for update
using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, active)
  values (
    new.id,
    nullif(lower(new.raw_user_meta_data->>'username'), ''),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    false
  );
  return new;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.user_category_permissions;
exception when duplicate_object then null;
end;
$$;

