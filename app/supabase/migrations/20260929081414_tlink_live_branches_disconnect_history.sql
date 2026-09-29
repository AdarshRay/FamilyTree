-- Live, consent-scoped TLink branches, audit history, and recoverable disconnects.

alter table public.tree_connections
  add column if not exists disconnected_at timestamptz,
  add column if not exists retain_copy boolean not null default false;

create table if not exists public.tlink_branch_snapshots (
  connection_id uuid not null references public.tree_connections (id) on delete cascade,
  source_tree_id uuid not null references public.family_trees (id) on delete cascade,
  branch jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (connection_id, source_tree_id),
  check (jsonb_typeof(branch) = 'object'),
  check (octet_length(branch::text) <= 10485760)
);

create table if not exists public.tlink_connection_events (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.tree_connections (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('connected', 'paused', 'resumed', 'branch_synced', 'disconnected_retained')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tlink_connection_events_connection_idx
  on public.tlink_connection_events (connection_id, created_at desc);

alter table public.tlink_branch_snapshots enable row level security;
alter table public.tlink_connection_events enable row level security;

create policy "participants read tlink branch snapshots"
on public.tlink_branch_snapshots for select to authenticated
using (
  exists (
    select 1 from public.tree_connections connection
    where connection.id = tlink_branch_snapshots.connection_id
      and (
        connection.approved_by_a = (select auth.uid())
        or connection.approved_by_b = (select auth.uid())
        or private.current_user_is_tree_member(connection.tree_a_id)
        or (connection.tree_b_id is not null and private.current_user_is_tree_member(connection.tree_b_id))
      )
  )
);

create policy "participants read tlink connection events"
on public.tlink_connection_events for select to authenticated
using (
  exists (
    select 1 from public.tree_connections connection
    where connection.id = tlink_connection_events.connection_id
      and (
        connection.approved_by_a = (select auth.uid())
        or connection.approved_by_b = (select auth.uid())
        or private.current_user_is_tree_member(connection.tree_a_id)
        or (connection.tree_b_id is not null and private.current_user_is_tree_member(connection.tree_b_id))
      )
  )
);

create or replace function public.sync_tlink_branches(target_tree_id uuid, branches jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_row public.tree_connections%rowtype;
  local_person_id uuid;
  branch_value jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.'; end if;
  if not private.current_user_has_tree_role(target_tree_id, array['owner', 'editor']::public.family_tree_role[]) then
    raise exception 'Only tree owners and editors can synchronize branches.';
  end if;
  if jsonb_typeof(branches) <> 'object' or octet_length(branches::text) > 52428800 then
    raise exception 'Invalid branch data.';
  end if;

  for connection_row in
    select * from public.tree_connections
    where active and disconnected_at is null and scope in ('branch', 'collaboration')
      and target_tree_id in (tree_a_id, tree_b_id)
  loop
    select person.local_person_id into local_person_id
    from public.tree_people person
    where person.tree_id = target_tree_id
      and person.canonical_person_id = connection_row.canonical_person_id
    order by person.updated_at desc limit 1;
    branch_value := branches -> local_person_id::text;
    if local_person_id is not null and branch_value is not null and jsonb_typeof(branch_value) = 'object' then
      insert into public.tlink_branch_snapshots (connection_id, source_tree_id, branch)
      values (connection_row.id, target_tree_id, branch_value)
      on conflict (connection_id, source_tree_id) do update
        set branch = excluded.branch,
            revision = public.tlink_branch_snapshots.revision + 1,
            updated_at = now();
      insert into public.tlink_connection_events (connection_id, actor_user_id, action, details)
      values (connection_row.id, (select auth.uid()), 'branch_synced', jsonb_build_object('tree_id', target_tree_id));
    end if;
  end loop;
end;
$$;

create or replace function public.disconnect_tree_connection(target_connection_id uuid, keep_shared_copy boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_row public.tree_connections%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.'; end if;
  select * into connection_row from public.tree_connections where id = target_connection_id for update;
  if connection_row.id is null or (select auth.uid()) not in (connection_row.approved_by_a, connection_row.approved_by_b) then
    raise exception 'Tree connection not found.';
  end if;

  -- The update invokes the collaboration cleanup trigger before any deletion.
  update public.tree_connections
    set active = false, disconnected_at = now(), retain_copy = keep_shared_copy, updated_at = now()
    where id = target_connection_id;
  if keep_shared_copy then
    insert into public.tlink_connection_events (connection_id, actor_user_id, action, details)
    values (target_connection_id, (select auth.uid()), 'disconnected_retained', jsonb_build_object('retained', true));
  else
    delete from public.tree_connections where id = target_connection_id;
  end if;
end;
$$;

create or replace function private.record_tlink_connection_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.tlink_connection_events (connection_id, actor_user_id, action)
    values (new.id, (select auth.uid()), 'connected');
  elsif old.active is distinct from new.active and new.disconnected_at is null then
    insert into public.tlink_connection_events (connection_id, actor_user_id, action)
    values (new.id, (select auth.uid()), case when new.active then 'resumed' else 'paused' end);
  end if;
  return new;
end;
$$;

drop trigger if exists after_tlink_connection_event on public.tree_connections;
create trigger after_tlink_connection_event
  after insert or update of active on public.tree_connections
  for each row execute function private.record_tlink_connection_event();

-- A disconnected connection cannot silently be resumed; a new mutual request is required.
create or replace function public.set_tree_connection_active(target_connection_id uuid, next_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.'; end if;
  update public.tree_connections
  set active = next_active, updated_at = now()
  where id = target_connection_id
    and disconnected_at is null
    and (approved_by_a = (select auth.uid()) or approved_by_b = (select auth.uid()));
  if not found then raise exception 'Tree connection not found or was permanently disconnected.'; end if;
end;
$$;

grant select on public.tlink_branch_snapshots, public.tlink_connection_events to authenticated;
grant execute on function public.sync_tlink_branches(uuid, jsonb) to authenticated;
grant execute on function public.disconnect_tree_connection(uuid, boolean) to authenticated;
revoke all on function public.sync_tlink_branches(uuid, jsonb) from public, anon;
revoke all on function public.disconnect_tree_connection(uuid, boolean) from public, anon;
revoke all on function private.record_tlink_connection_event() from public, anon, authenticated;
