-- A TLink approval must not prevent its participant from deleting their account.
-- Remove bilateral connections when either approving account is deleted.
alter table public.tree_connections
  drop constraint tree_connections_approved_by_a_fkey,
  drop constraint tree_connections_approved_by_b_fkey,
  add constraint tree_connections_approved_by_a_fkey
    foreign key (approved_by_a) references auth.users (id) on delete cascade,
  add constraint tree_connections_approved_by_b_fkey
    foreign key (approved_by_b) references auth.users (id) on delete cascade;

-- Revoke only memberships created by this connection, before its grant records
-- cascade away. Direct invitations and ownership of other trees are preserved.
create or replace function private.remove_deleted_tlink_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.family_tree_members membership
  using private.tlink_membership_grants grant_row
  where grant_row.connection_id = old.id
    and membership.tree_id = grant_row.tree_id
    and membership.user_id = grant_row.user_id;
  return old;
end;
$$;

create trigger before_deleted_tlink_memberships
  before delete on public.tree_connections
  for each row execute function private.remove_deleted_tlink_memberships();

revoke all on function private.remove_deleted_tlink_memberships() from public, anon, authenticated;
