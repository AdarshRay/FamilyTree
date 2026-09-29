create table if not exists private.tlink_membership_grants (
  connection_id uuid not null references public.tree_connections (id) on delete cascade,
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (connection_id, tree_id, user_id)
);

create or replace function private.sync_tlink_collaboration_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope <> 'collaboration' then return new; end if;

  if not new.active then
    delete from public.family_tree_members membership
    using private.tlink_membership_grants grant_row
    where grant_row.connection_id = new.id
      and membership.tree_id = grant_row.tree_id
      and membership.user_id = grant_row.user_id;
    delete from private.tlink_membership_grants where connection_id = new.id;
    return new;
  end if;

  insert into public.family_tree_members (tree_id, user_id, role)
  values (new.tree_a_id, new.approved_by_b, 'editor')
  on conflict (tree_id, user_id) do nothing;
  if found then
    insert into private.tlink_membership_grants (connection_id, tree_id, user_id)
    values (new.id, new.tree_a_id, new.approved_by_b)
    on conflict do nothing;
  end if;

  if new.tree_b_id is not null then
    insert into public.family_tree_members (tree_id, user_id, role)
    values (new.tree_b_id, new.approved_by_a, 'editor')
    on conflict (tree_id, user_id) do nothing;
    if found then
      insert into private.tlink_membership_grants (connection_id, tree_id, user_id)
      values (new.id, new.tree_b_id, new.approved_by_a)
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists after_tlink_collaboration_memberships on public.tree_connections;
create trigger after_tlink_collaboration_memberships
  after insert or update of active on public.tree_connections
  for each row execute function private.sync_tlink_collaboration_memberships();

revoke all on private.tlink_membership_grants from public, anon, authenticated;
revoke all on function private.sync_tlink_collaboration_memberships() from public, anon, authenticated;
