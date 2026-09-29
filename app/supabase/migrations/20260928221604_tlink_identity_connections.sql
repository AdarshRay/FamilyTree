-- TLink identity and consent-based tree connections.
-- Public TLink IDs use 128 bits of cryptographic randomness. The UNIQUE
-- constraint is the final collision guard and IDs are never recycled.

create or replace function private.new_tlink_id()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  token text := upper(encode(extensions.gen_random_bytes(16), 'hex'));
begin
  return 'TLINK-' || substring(token, 1, 4) || '-' || substring(token, 5, 4) || '-' ||
    substring(token, 9, 4) || '-' || substring(token, 13, 4) || '-' ||
    substring(token, 17, 4) || '-' || substring(token, 21, 4) || '-' ||
    substring(token, 25, 4) || '-' || substring(token, 29, 4);
end;
$$;

alter table public.profiles add column if not exists tlink_id text;
create unique index if not exists profiles_tlink_id_key on public.profiles (upper(tlink_id));

do $$
declare
  profile_row record;
  candidate text;
begin
  for profile_row in select id from public.profiles where tlink_id is null loop
    loop
      candidate := private.new_tlink_id();
      exit when not exists (select 1 from public.profiles where upper(tlink_id) = candidate);
    end loop;
    update public.profiles set tlink_id = candidate where id = profile_row.id;
  end loop;
end
$$;

alter table public.profiles alter column tlink_id set default private.new_tlink_id();
alter table public.profiles alter column tlink_id set not null;

create table if not exists public.canonical_people (
  id uuid primary key default gen_random_uuid(),
  claimed_by uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists canonical_person_id uuid references public.canonical_people (id);

insert into public.canonical_people (claimed_by)
select profile.id from public.profiles profile
where not exists (select 1 from public.canonical_people person where person.claimed_by = profile.id);

update public.profiles profile
set canonical_person_id = person.id
from public.canonical_people person
where person.claimed_by = profile.id and profile.canonical_person_id is null;

alter table public.profiles alter column canonical_person_id set not null;
create unique index if not exists profiles_canonical_person_key on public.profiles (canonical_person_id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  person_id uuid := gen_random_uuid();
begin
  insert into public.canonical_people (id, claimed_by) values (person_id, new.id);
  insert into public.profiles (id, display_name, email, avatar_url, canonical_person_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email, 'Family Tree User'),
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'avatar_url',
    person_id
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end;
$$;

create table if not exists public.tree_people (
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  local_person_id uuid not null,
  canonical_person_id uuid not null references public.canonical_people (id),
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tree_id, local_person_id)
);
create index if not exists tree_people_canonical_idx on public.tree_people (canonical_person_id);

create table if not exists public.tlink_requests (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  source_tree_id uuid not null references public.family_trees (id) on delete cascade,
  source_local_person_id uuid not null,
  source_tree_name text not null,
  source_person_name text not null,
  requested_scope text not null default 'identity' check (requested_scope in ('identity', 'branch', 'collaboration')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_user_id <> recipient_user_id)
);
create unique index if not exists tlink_requests_pending_unique
  on public.tlink_requests (sender_user_id, recipient_user_id, source_tree_id, source_local_person_id)
  where status = 'pending';
create index if not exists tlink_requests_recipient_idx on public.tlink_requests (recipient_user_id, created_at desc);

create table if not exists public.tree_connections (
  id uuid primary key default gen_random_uuid(),
  tree_a_id uuid not null references public.family_trees (id) on delete cascade,
  tree_b_id uuid references public.family_trees (id) on delete cascade,
  canonical_person_id uuid not null references public.canonical_people (id),
  scope text not null check (scope in ('identity', 'branch', 'collaboration')),
  approved_by_a uuid not null references auth.users (id),
  approved_by_b uuid not null references auth.users (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tree_connections_active_identity_key
  on public.tree_connections (tree_a_id, coalesce(tree_b_id, '00000000-0000-0000-0000-000000000000'::uuid), canonical_person_id)
  where active;

alter table public.canonical_people enable row level security;
alter table public.tree_people enable row level security;
alter table public.tlink_requests enable row level security;
alter table public.tree_connections enable row level security;

create policy "users read their canonical identity" on public.canonical_people for select to authenticated
using (
  claimed_by = (select auth.uid())
  or exists (
    select 1 from public.tree_people person
    where person.canonical_person_id = canonical_people.id
      and private.current_user_is_tree_member(person.tree_id)
  )
);

create policy "tree collaborators read person identities" on public.tree_people for select to authenticated
using (private.current_user_is_tree_member(tree_id));

create policy "participants read tlink requests" on public.tlink_requests for select to authenticated
using ((select auth.uid()) in (sender_user_id, recipient_user_id));

create policy "participants read tree connections" on public.tree_connections for select to authenticated
using (
  approved_by_a = (select auth.uid()) or approved_by_b = (select auth.uid())
  or private.current_user_is_tree_member(tree_a_id)
  or (tree_b_id is not null and private.current_user_is_tree_member(tree_b_id))
);

drop policy if exists "users can read their own profile" on public.profiles;
create policy "users can read their own profile" on public.profiles for select to authenticated
using (id = (select auth.uid()));

create or replace function public.register_tree_people(target_tree_id uuid, members jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member jsonb;
  local_id uuid;
  member_name text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.'; end if;
  if not private.current_user_has_tree_role(target_tree_id, array['owner', 'editor']::public.family_tree_role[]) then
    raise exception 'Only tree owners and editors can register people.';
  end if;
  if jsonb_typeof(members) <> 'array' or jsonb_array_length(members) > 5000 then
    raise exception 'Invalid member list.';
  end if;

  for member in select value from jsonb_array_elements(members) loop
    local_id := (member ->> 'id')::uuid;
    member_name := left(trim(member ->> 'name'), 200);
    if member_name = '' then raise exception 'Every person needs a name.'; end if;
    insert into public.canonical_people (id) values (local_id) on conflict (id) do nothing;
    insert into public.tree_people (tree_id, local_person_id, canonical_person_id, display_name)
    values (target_tree_id, local_id, local_id, member_name)
    on conflict (tree_id, local_person_id) do update
      set display_name = excluded.display_name, updated_at = now();
  end loop;
end;
$$;

create or replace function public.claim_tree_person(target_tree_id uuid, target_local_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_id uuid := (select auth.uid());
  my_canonical uuid;
  target_canonical uuid;
begin
  if my_id is null then raise exception 'Sign in required.'; end if;
  if not private.current_user_is_tree_member(target_tree_id) then raise exception 'Tree access required.'; end if;
  select canonical_person_id into my_canonical from public.profiles where id = my_id;
  select canonical_person_id into target_canonical from public.tree_people
    where tree_id = target_tree_id and local_person_id = target_local_person_id;
  if target_canonical is null then raise exception 'Person identity is not registered.'; end if;
  if exists (select 1 from public.canonical_people where id = target_canonical and claimed_by is not null and claimed_by <> my_id) then
    raise exception 'That person is already claimed by another account.';
  end if;
  update public.tree_people set canonical_person_id = my_canonical, updated_at = now()
    where tree_id = target_tree_id and local_person_id = target_local_person_id;
end;
$$;

create or replace function public.send_tlink_request(
  target_tree_id uuid,
  target_local_person_id uuid,
  recipient_tlink_id text,
  connection_scope text default 'identity'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_id uuid := (select auth.uid());
  recipient_id uuid;
  request_id uuid;
begin
  if sender_id is null then raise exception 'Sign in required.'; end if;
  if connection_scope not in ('identity', 'branch', 'collaboration') then raise exception 'Invalid connection scope.'; end if;
  if not private.current_user_has_tree_role(target_tree_id, array['owner', 'editor']::public.family_tree_role[]) then
    raise exception 'Only tree owners and editors can connect people.';
  end if;
  if not exists (select 1 from public.tree_people where tree_id = target_tree_id and local_person_id = target_local_person_id) then
    raise exception 'Person identity is not registered.';
  end if;
  if (select count(*) from public.tlink_requests where sender_user_id = sender_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many connection requests. Try again later.';
  end if;
  select id into recipient_id from public.profiles where upper(tlink_id) = upper(trim(recipient_tlink_id));
  if recipient_id is null or recipient_id = sender_id then raise exception 'That TLink ID cannot receive this request.'; end if;

  insert into public.tlink_requests (
    sender_user_id, recipient_user_id, source_tree_id, source_local_person_id,
    source_tree_name, source_person_name, requested_scope
  )
  select sender_id, recipient_id, target_tree_id, target_local_person_id,
    tree.name, person.display_name, connection_scope
  from public.family_trees tree
  join public.tree_people person on person.tree_id = tree.id and person.local_person_id = target_local_person_id
  where tree.id = target_tree_id
  returning id into request_id;
  return request_id;
exception when unique_violation then
  raise exception 'A request for this person is already pending.';
end;
$$;

create or replace function public.respond_tlink_request(
  target_request_id uuid,
  accept_request boolean,
  target_tree_id uuid default null,
  target_local_person_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_id uuid := (select auth.uid());
  request_row public.tlink_requests%rowtype;
  my_canonical uuid;
begin
  if my_id is null then raise exception 'Sign in required.'; end if;
  select * into request_row from public.tlink_requests where id = target_request_id for update;
  if request_row.id is null or request_row.recipient_user_id <> my_id or request_row.status <> 'pending' then
    raise exception 'This request is no longer available.';
  end if;
  if not accept_request then
    update public.tlink_requests set status = 'declined', responded_at = now() where id = target_request_id;
    return;
  end if;

  select canonical_person_id into my_canonical from public.profiles where id = my_id;
  if target_tree_id is not null then
    if target_local_person_id is null or not private.current_user_has_tree_role(target_tree_id, array['owner', 'editor']::public.family_tree_role[]) then
      raise exception 'Choose a tree profile you can edit.';
    end if;
    if not exists (select 1 from public.tree_people where tree_id = target_tree_id and local_person_id = target_local_person_id) then
      raise exception 'Selected profile is not registered.';
    end if;
    update public.tree_people set canonical_person_id = my_canonical, updated_at = now()
      where tree_id = target_tree_id and local_person_id = target_local_person_id;
  end if;

  update public.tree_people set canonical_person_id = my_canonical, updated_at = now()
    where tree_id = request_row.source_tree_id and local_person_id = request_row.source_local_person_id;
  insert into public.tree_connections
    (tree_a_id, tree_b_id, canonical_person_id, scope, approved_by_a, approved_by_b)
  values
    (request_row.source_tree_id, target_tree_id, my_canonical, request_row.requested_scope, request_row.sender_user_id, my_id)
  on conflict do nothing;
  update public.tlink_requests set status = 'accepted', responded_at = now() where id = target_request_id;
end;
$$;

revoke all on function private.new_tlink_id() from public, anon, authenticated;
revoke all on function public.register_tree_people(uuid, jsonb) from public, anon;
revoke all on function public.claim_tree_person(uuid, uuid) from public, anon;
revoke all on function public.send_tlink_request(uuid, uuid, text, text) from public, anon;
revoke all on function public.respond_tlink_request(uuid, boolean, uuid, uuid) from public, anon;
grant execute on function public.register_tree_people(uuid, jsonb) to authenticated;
grant execute on function public.claim_tree_person(uuid, uuid) to authenticated;
grant execute on function public.send_tlink_request(uuid, uuid, text, text) to authenticated;
grant execute on function public.respond_tlink_request(uuid, boolean, uuid, uuid) to authenticated;

grant select on public.canonical_people, public.tree_people, public.tlink_requests, public.tree_connections to authenticated;
