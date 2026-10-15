-- Run against a migrated database. All fixture changes are rolled back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  collaborator_id uuid := gen_random_uuid();
  other_owner_id uuid := gen_random_uuid();
  first_tree uuid := gen_random_uuid();
  other_tree uuid := gen_random_uuid();
  connection_id uuid;
  person_id uuid;
begin
  insert into auth.users (id,email,raw_user_meta_data)
  values
    (owner_id, owner_id::text || '@example.invalid', '{"full_name":"Regression owner"}'),
    (collaborator_id, collaborator_id::text || '@example.invalid', '{"full_name":"Regression collaborator"}'),
    (other_owner_id, other_owner_id::text || '@example.invalid', '{"full_name":"Regression other owner"}');

  insert into public.family_trees (id,owner_id,name,root,snapshot)
  values
    (first_tree,owner_id,'Deletion regression A','{"person":{"name":"Founder A","gender":"m"}}','{}'),
    (other_tree,other_owner_id,'Deletion regression B','{"person":{"name":"Founder B","gender":"m"}}','{}');
  select canonical_person_id into person_id from public.profiles where id=collaborator_id;
  insert into public.tree_connections (tree_a_id,tree_b_id,canonical_person_id,scope,approved_by_a,approved_by_b)
  values (first_tree,other_tree,person_id,'collaboration',owner_id,collaborator_id)
  returning id into connection_id;

  if not exists (select 1 from public.family_tree_members where tree_id=other_tree and user_id=owner_id and role='editor') then
    raise exception 'Fixture did not grant collaboration membership.';
  end if;

  delete from auth.users where id=collaborator_id;
  if exists (select 1 from public.tree_connections where id=connection_id) then
    raise exception 'Deleting an approving user left a connection behind.';
  end if;
  if exists (select 1 from public.family_tree_members where tree_id=other_tree and user_id=owner_id) then
    raise exception 'Deleting a connection left its collaboration access behind.';
  end if;
  if not exists (select 1 from public.family_trees tree where tree.id=other_tree and tree.owner_id=other_owner_id) then
    raise exception 'Deletion removed an unrelated owner tree.';
  end if;
  if not exists (select 1 from public.family_tree_members where tree_id=first_tree and user_id=owner_id and role='owner') then
    raise exception 'Deletion removed direct ownership.';
  end if;
end;
$$;
rollback;
