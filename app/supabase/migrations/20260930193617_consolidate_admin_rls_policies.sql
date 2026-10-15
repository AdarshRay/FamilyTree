-- Consolidate equivalent permissive policies so Postgres evaluates one policy
-- per role/action while preserving member, owner, editor, and admin access.

drop policy if exists "admins read all profiles" on public.profiles;
drop policy if exists "profiles are readable by tree collaborators" on public.profiles;
drop policy if exists "users can read their own profile" on public.profiles;
create policy "authorized users read profiles"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or private.current_user_shares_tree_with(id)
    or (select private.current_user_is_admin())
  );

drop policy if exists "admins read all trees" on public.family_trees;
drop policy if exists "members can read family trees" on public.family_trees;
create policy "members and admins read family trees"
  on public.family_trees for select
  to authenticated
  using (
    private.current_user_is_tree_member(id)
    or (select private.current_user_is_admin())
  );

drop policy if exists "admins update all trees" on public.family_trees;
drop policy if exists "owners and editors can update family trees" on public.family_trees;
create policy "editors and admins update family trees"
  on public.family_trees for update
  to authenticated
  using (
    private.current_user_has_tree_role(id, array['owner', 'editor']::public.family_tree_role[])
    or (select private.current_user_is_admin())
  )
  with check (
    private.current_user_has_tree_role(id, array['owner', 'editor']::public.family_tree_role[])
    or (select private.current_user_is_admin())
  );

drop policy if exists "admins read all tree memberships" on public.family_tree_members;
drop policy if exists "members and owners can read tree memberships" on public.family_tree_members;
create policy "authorized users read tree memberships"
  on public.family_tree_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[])
    or (select private.current_user_is_admin())
  );

drop policy if exists "admins read all tree invitations" on public.family_tree_invitations;
drop policy if exists "owners and invited users can read invitations" on public.family_tree_invitations;
create policy "authorized users read tree invitations"
  on public.family_tree_invitations for select
  to authenticated
  using (
    private.current_user_has_tree_role(tree_id, array['owner']::public.family_tree_role[])
    or (
      accepted_at is null
      and lower(invited_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    )
    or (select private.current_user_is_admin())
  );

drop policy if exists "admins read all tree people" on public.tree_people;
drop policy if exists "tree collaborators read person identities" on public.tree_people;
create policy "members and admins read tree people"
  on public.tree_people for select
  to authenticated
  using (
    private.current_user_is_tree_member(tree_id)
    or (select private.current_user_is_admin())
  );

drop policy if exists "admins read all family photos" on storage.objects;
drop policy if exists "tree members can read family photos" on storage.objects;
create policy "members and admins read family photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and (
      private.current_user_is_tree_member((storage.foldername(name))[1]::uuid)
      or (select private.current_user_is_admin())
    )
  );

drop policy if exists "admins upload family photos" on storage.objects;
drop policy if exists "tree editors can upload family photos" on storage.objects;
create policy "editors and admins upload family photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'family-tree-photos'
    and (
      private.current_user_has_tree_role((storage.foldername(name))[1]::uuid, array['owner', 'editor']::public.family_tree_role[])
      or (select private.current_user_is_admin())
    )
  );

drop policy if exists "admins update family photos" on storage.objects;
drop policy if exists "tree editors can update family photos" on storage.objects;
create policy "editors and admins update family photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and (
      private.current_user_has_tree_role((storage.foldername(name))[1]::uuid, array['owner', 'editor']::public.family_tree_role[])
      or (select private.current_user_is_admin())
    )
  )
  with check (
    bucket_id = 'family-tree-photos'
    and (
      private.current_user_has_tree_role((storage.foldername(name))[1]::uuid, array['owner', 'editor']::public.family_tree_role[])
      or (select private.current_user_is_admin())
    )
  );

drop policy if exists "admins delete family photos" on storage.objects;
drop policy if exists "tree editors can delete family photos" on storage.objects;
create policy "editors and admins delete family photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and (
      private.current_user_has_tree_role((storage.foldername(name))[1]::uuid, array['owner', 'editor']::public.family_tree_role[])
      or (select private.current_user_is_admin())
    )
  );
