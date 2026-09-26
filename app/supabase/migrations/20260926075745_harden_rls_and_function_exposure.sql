-- Keep internal SECURITY DEFINER helpers out of the exposed public API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.current_user_has_tree_role(uuid, public.family_tree_role[]) set schema private;
alter function public.current_user_is_tree_member(uuid) set schema private;
alter function public.current_user_invited_to_tree(uuid) set schema private;
alter function public.current_user_shares_tree_with(uuid) set schema private;

revoke all on function private.current_user_has_tree_role(uuid, public.family_tree_role[]) from public, anon;
revoke all on function private.current_user_is_tree_member(uuid) from public, anon;
revoke all on function private.current_user_invited_to_tree(uuid) from public, anon;
revoke all on function private.current_user_shares_tree_with(uuid) from public, anon;
grant execute on function private.current_user_has_tree_role(uuid, public.family_tree_role[]) to authenticated;
grant execute on function private.current_user_is_tree_member(uuid) to authenticated;
grant execute on function private.current_user_invited_to_tree(uuid) to authenticated;
grant execute on function private.current_user_shares_tree_with(uuid) to authenticated;

create or replace function private.current_user_is_tree_member(target_tree_id uuid)
returns boolean
language sql
security definer
set search_path = public, private
stable
as $$
  select private.current_user_has_tree_role(
    target_tree_id,
    array['owner', 'editor', 'viewer']::public.family_tree_role[]
  );
$$;

create or replace function public.invite_family_tree_member(
  target_tree_id uuid,
  invite_email text,
  invite_role public.family_tree_role
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  normalized_email text := lower(trim(invite_email));
  matched_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to share a tree.';
  end if;
  if not private.current_user_has_tree_role(target_tree_id, array['owner']::public.family_tree_role[]) then
    raise exception 'Only the tree owner can manage sharing.';
  end if;
  if invite_role not in ('editor', 'viewer') then
    raise exception 'Shared users can only be editors or viewers.';
  end if;
  if normalized_email = '' or position('@' in normalized_email) < 2 then
    raise exception 'Enter a valid email address.';
  end if;

  select id into matched_user_id from public.profiles where lower(email) = normalized_email limit 1;
  if matched_user_id is not null then
    insert into public.family_tree_members (tree_id, user_id, role, invited_email)
    values (target_tree_id, matched_user_id, invite_role, normalized_email)
    on conflict (tree_id, user_id) do update
      set role = case when public.family_tree_members.role = 'owner' then public.family_tree_members.role else excluded.role end,
          invited_email = excluded.invited_email;
    update public.family_tree_invitations
      set accepted_by = matched_user_id, accepted_at = coalesce(accepted_at, now()), updated_at = now()
      where tree_id = target_tree_id and lower(invited_email) = normalized_email;
    return 'member';
  end if;

  insert into public.family_tree_invitations (tree_id, invited_email, role, invited_by)
  values (target_tree_id, normalized_email, invite_role, auth.uid())
  on conflict (tree_id, invited_email) do update
    set role = excluded.role, invited_by = excluded.invited_by, accepted_by = null, accepted_at = null, updated_at = now();
  return 'invitation';
end;
$$;

-- Recreate policies with init-plan friendly auth lookups and a single SELECT
-- policy per role/table. This keeps authorization unchanged while avoiding
-- per-row JWT function evaluation and duplicate permissive policies.
drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "profiles are readable by tree collaborators" on public.profiles;
create policy "profiles are readable by tree collaborators"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or private.current_user_shares_tree_with(id));

drop policy if exists "owners can create family trees" on public.family_trees;
create policy "owners can create family trees"
  on public.family_trees for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "members can read family trees" on public.family_trees;
create policy "members can read family trees"
  on public.family_trees for select
  to authenticated
  using (private.current_user_is_tree_member(id));

drop policy if exists "owners and editors can update family trees" on public.family_trees;
create policy "owners and editors can update family trees"
  on public.family_trees for update
  to authenticated
  using (private.current_user_has_tree_role(id, array['owner', 'editor']::public.family_tree_role[]))
  with check (private.current_user_has_tree_role(id, array['owner', 'editor']::public.family_tree_role[]));

drop policy if exists "members can read their tree memberships" on public.family_tree_members;
drop policy if exists "owners can manage members" on public.family_tree_members;
create policy "members and owners can read tree memberships"
  on public.family_tree_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[])
  );
create policy "owners can add members"
  on public.family_tree_members for insert
  to authenticated
  with check (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]));
create policy "owners can update members"
  on public.family_tree_members for update
  to authenticated
  using (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]))
  with check (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]));
create policy "owners can remove members"
  on public.family_tree_members for delete
  to authenticated
  using (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]));

drop policy if exists "owners can manage invitations" on public.family_tree_invitations;
drop policy if exists "invited users can read invitations" on public.family_tree_invitations;
create policy "owners and invited users can read invitations"
  on public.family_tree_invitations for select
  to authenticated
  using (
    private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[])
    or (
      accepted_at is null
      and lower(invited_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    )
  );
create policy "owners can add invitations"
  on public.family_tree_invitations for insert
  to authenticated
  with check (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]));
create policy "owners can update invitations"
  on public.family_tree_invitations for update
  to authenticated
  using (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]))
  with check (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]));
create policy "owners can remove invitations"
  on public.family_tree_invitations for delete
  to authenticated
  using (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]));

drop policy if exists "owners can read publish targets" on public.tree_publish_targets;
create policy "owners can read publish targets"
  on public.tree_publish_targets for select
  to authenticated
  using (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]));

drop policy if exists "owners can read publish jobs" on public.publish_jobs;
create policy "owners can read publish jobs"
  on public.publish_jobs for select
  to authenticated
  using (private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[]));

drop policy if exists "tree members can read family photos" on storage.objects;
create policy "tree members can read family photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and private.current_user_is_tree_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "tree editors can upload family photos" on storage.objects;
create policy "tree editors can upload family photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'family-tree-photos'
    and private.current_user_has_tree_role((storage.foldername(name))[1]::uuid, array['owner', 'editor']::public.family_tree_role[])
  );

drop policy if exists "tree editors can update family photos" on storage.objects;
create policy "tree editors can update family photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and private.current_user_has_tree_role((storage.foldername(name))[1]::uuid, array['owner', 'editor']::public.family_tree_role[])
  )
  with check (
    bucket_id = 'family-tree-photos'
    and private.current_user_has_tree_role((storage.foldername(name))[1]::uuid, array['owner', 'editor']::public.family_tree_role[])
  );

drop policy if exists "tree editors can delete family photos" on storage.objects;
create policy "tree editors can delete family photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and private.current_user_has_tree_role((storage.foldername(name))[1]::uuid, array['owner', 'editor']::public.family_tree_role[])
  );
