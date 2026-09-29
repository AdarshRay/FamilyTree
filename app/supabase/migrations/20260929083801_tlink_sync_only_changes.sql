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
  changed_rows integer;
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
            updated_at = now()
        where public.tlink_branch_snapshots.branch is distinct from excluded.branch;
      get diagnostics changed_rows = row_count;
      if changed_rows > 0 then
        insert into public.tlink_connection_events (connection_id, actor_user_id, action, details)
        values (connection_row.id, (select auth.uid()), 'branch_synced', jsonb_build_object('tree_id', target_tree_id));
      end if;
    end if;
  end loop;
end;
$$;
