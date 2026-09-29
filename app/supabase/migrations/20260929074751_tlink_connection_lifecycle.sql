alter table public.tree_connections add column if not exists tree_a_name text;
alter table public.tree_connections add column if not exists tree_b_name text;
alter table public.tree_connections add column if not exists person_name text;

create or replace function private.populate_tree_connection_labels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select name into new.tree_a_name from public.family_trees where id = new.tree_a_id;
  if new.tree_b_id is not null then
    select name into new.tree_b_name from public.family_trees where id = new.tree_b_id;
  end if;
  select display_name into new.person_name
  from public.tree_people
  where tree_id = new.tree_a_id and canonical_person_id = new.canonical_person_id
  order by updated_at desc limit 1;
  return new;
end;
$$;

drop trigger if exists before_tree_connection_labels on public.tree_connections;
create trigger before_tree_connection_labels
  before insert or update of tree_a_id, tree_b_id, canonical_person_id on public.tree_connections
  for each row execute function private.populate_tree_connection_labels();

update public.tree_connections connection
set tree_a_name = (select name from public.family_trees where id = connection.tree_a_id),
    tree_b_name = (select name from public.family_trees where id = connection.tree_b_id),
    person_name = (
      select display_name from public.tree_people
      where tree_id = connection.tree_a_id and canonical_person_id = connection.canonical_person_id
      order by updated_at desc limit 1
    );

create or replace function public.cancel_tlink_request(target_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required.'; end if;
  update public.tlink_requests
  set status = 'cancelled', responded_at = now()
  where id = target_request_id
    and sender_user_id = (select auth.uid())
    and status = 'pending';
  if not found then raise exception 'This request cannot be cancelled.'; end if;
end;
$$;

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
    and (approved_by_a = (select auth.uid()) or approved_by_b = (select auth.uid()));
  if not found then raise exception 'Tree connection not found.'; end if;
end;
$$;

revoke all on function private.populate_tree_connection_labels() from public, anon, authenticated;
revoke all on function public.cancel_tlink_request(uuid) from public, anon;
revoke all on function public.set_tree_connection_active(uuid, boolean) from public, anon;
grant execute on function public.cancel_tlink_request(uuid) to authenticated;
grant execute on function public.set_tree_connection_active(uuid, boolean) to authenticated;
