drop policy if exists "owners can delete family trees" on public.family_trees;
create policy "owners can delete family trees"
  on public.family_trees for delete
  to authenticated
  using (private.current_user_has_tree_role(id, array['owner']::public.family_tree_role[]));
