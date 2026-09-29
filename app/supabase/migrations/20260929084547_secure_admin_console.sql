-- Server-enforced administration. The original account is an immutable root
-- super admin; delegated admins can manage family content but never roles.

create table if not exists private.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin')),
  is_root boolean not null default false,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (not is_root or role = 'super_admin')
);

create table if not exists private.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users (id) on delete set null,
  target_tree_id uuid references public.family_trees (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on private.admin_audit_log (created_at desc);

do $$
declare
  root_user_id uuid;
begin
  select id into root_user_id from auth.users where lower(email) = 'ray.adarsh7@gmail.com' limit 1;
  if root_user_id is null then
    raise exception 'Root super admin account was not found.';
  end if;
  insert into private.admin_users (user_id, role, is_root, granted_by)
  values (root_user_id, 'super_admin', true, root_user_id)
  on conflict (user_id) do update set role = 'super_admin', is_root = true;
end
$$;

create or replace function private.current_user_admin_role()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select role from private.admin_users where user_id = (select auth.uid());
$$;

create or replace function private.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from private.admin_users where user_id = (select auth.uid()));
$$;

create or replace function private.current_user_is_super_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from private.admin_users
    where user_id = (select auth.uid()) and role = 'super_admin'
  );
$$;

create or replace function public.get_admin_access()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select private.current_user_admin_role();
$$;

create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamptz,
  updated_at timestamptz,
  tree_count bigint,
  photo_count bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not private.current_user_is_admin() then raise exception 'Administrator access required.'; end if;
  return query
  select profile.id, profile.display_name, profile.email, profile.avatar_url,
    profile.created_at, profile.updated_at,
    (select count(*) from public.family_trees tree where tree.owner_id = profile.id),
    (
      select count(*) from storage.objects object
      where object.bucket_id = 'family-tree-photos'
        and exists (
          select 1 from public.family_trees tree
          where tree.owner_id = profile.id
            and tree.id::text = (storage.foldername(object.name))[1]
        )
    )
  from public.profiles profile
  order by profile.created_at desc;
end;
$$;

create or replace function public.admin_list_roles()
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  is_root boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not private.current_user_is_admin() then raise exception 'Administrator access required.'; end if;
  return query
  select admin.user_id, profile.display_name, profile.email, admin.role, admin.is_root, admin.created_at
  from private.admin_users admin
  join public.profiles profile on profile.id = admin.user_id
  order by admin.is_root desc, admin.created_at;
end;
$$;

create or replace function public.admin_grant_by_email(target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  if not private.current_user_is_super_admin() then raise exception 'Only the super admin can grant administrator access.'; end if;
  select id into target_id from public.profiles where lower(email) = lower(trim(target_email));
  if target_id is null then raise exception 'No FamilyTree account uses that email address.'; end if;
  insert into private.admin_users (user_id, role, granted_by)
  values (target_id, 'admin', (select auth.uid()))
  on conflict (user_id) do update
    set role = case when private.admin_users.is_root then 'super_admin' else 'admin' end,
        granted_by = excluded.granted_by;
  insert into private.admin_audit_log (actor_user_id, action, target_user_id)
  values ((select auth.uid()), 'admin_granted', target_id);
end;
$$;

create or replace function public.admin_revoke(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.current_user_is_super_admin() then raise exception 'Only the super admin can remove administrator access.'; end if;
  if exists (select 1 from private.admin_users where user_id = target_user_id and is_root) then
    raise exception 'The root super admin cannot be removed.';
  end if;
  delete from private.admin_users where user_id = target_user_id and role = 'admin';
  if not found then raise exception 'Administrator not found.'; end if;
  insert into private.admin_audit_log (actor_user_id, action, target_user_id)
  values ((select auth.uid()), 'admin_revoked', target_user_id);
end;
$$;

create or replace function public.admin_update_user_profile(target_user_id uuid, next_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.current_user_is_admin() then raise exception 'Administrator access required.'; end if;
  if length(trim(next_display_name)) < 1 or length(trim(next_display_name)) > 200 then
    raise exception 'Enter a display name between 1 and 200 characters.';
  end if;
  update public.profiles set display_name = trim(next_display_name), updated_at = now() where id = target_user_id;
  if not found then raise exception 'User not found.'; end if;
  insert into private.admin_audit_log (actor_user_id, action, target_user_id, details)
  values ((select auth.uid()), 'profile_updated', target_user_id, jsonb_build_object('display_name', trim(next_display_name)));
end;
$$;

-- Admins can open and edit any tree through the same audited application UI.
create policy "admins read all profiles" on public.profiles for select to authenticated
using ((select private.current_user_is_admin()));
create policy "admins read all trees" on public.family_trees for select to authenticated
using ((select private.current_user_is_admin()));
create policy "admins update all trees" on public.family_trees for update to authenticated
using ((select private.current_user_is_admin()))
with check ((select private.current_user_is_admin()));
create policy "admins read all tree memberships" on public.family_tree_members for select to authenticated
using ((select private.current_user_is_admin()));
create policy "admins read all tree invitations" on public.family_tree_invitations for select to authenticated
using ((select private.current_user_is_admin()));
create policy "admins read all tree people" on public.tree_people for select to authenticated
using ((select private.current_user_is_admin()));
create policy "admins update all tree people" on public.tree_people for update to authenticated
using ((select private.current_user_is_admin()))
with check ((select private.current_user_is_admin()));

create policy "admins read all family photos" on storage.objects for select to authenticated
using (bucket_id = 'family-tree-photos' and (select private.current_user_is_admin()));
create policy "admins upload family photos" on storage.objects for insert to authenticated
with check (bucket_id = 'family-tree-photos' and (select private.current_user_is_admin()));
create policy "admins update family photos" on storage.objects for update to authenticated
using (bucket_id = 'family-tree-photos' and (select private.current_user_is_admin()))
with check (bucket_id = 'family-tree-photos' and (select private.current_user_is_admin()));
create policy "admins delete family photos" on storage.objects for delete to authenticated
using (bucket_id = 'family-tree-photos' and (select private.current_user_is_admin()));

revoke all on private.admin_users, private.admin_audit_log from public, anon, authenticated;
revoke all on function private.current_user_admin_role() from public, anon, authenticated;
revoke all on function private.current_user_is_admin() from public, anon, authenticated;
revoke all on function private.current_user_is_super_admin() from public, anon, authenticated;
revoke all on function public.get_admin_access() from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_list_roles() from public, anon;
revoke all on function public.admin_grant_by_email(text) from public, anon;
revoke all on function public.admin_revoke(uuid) from public, anon;
revoke all on function public.admin_update_user_profile(uuid, text) from public, anon;
grant execute on function public.get_admin_access() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_list_roles() to authenticated;
grant execute on function public.admin_grant_by_email(text) to authenticated;
grant execute on function public.admin_revoke(uuid) to authenticated;
grant execute on function public.admin_update_user_profile(uuid, text) to authenticated;
