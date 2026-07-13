create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_trees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  member_count integer not null default 0,
  cover_names text[] not null default '{}',
  root jsonb not null,
  snapshot jsonb not null default '{"overrides":{},"structure":{"childrenOf":{},"spouseOf":{},"parentsOf":{},"removed":[],"renames":{}}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'family_tree_role') then
    create type public.family_tree_role as enum ('owner', 'editor', 'viewer');
  end if;
end
$$;

create table if not exists public.family_tree_members (
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.family_tree_role not null default 'viewer',
  invited_email text,
  created_at timestamptz not null default now(),
  primary key (tree_id, user_id)
);

alter table public.profiles enable row level security;
alter table public.family_trees enable row level security;
alter table public.family_tree_members enable row level security;

create policy "profiles are readable by signed in users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "members can read their tree memberships"
  on public.family_tree_members for select
  to authenticated
  using (user_id = auth.uid());

create policy "members can read family trees"
  on public.family_trees for select
  to authenticated
  using (
    exists (
      select 1
      from public.family_tree_members m
      where m.tree_id = family_trees.id
        and m.user_id = auth.uid()
    )
  );

create policy "owners can create family trees"
  on public.family_trees for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners and editors can update family trees"
  on public.family_trees for update
  to authenticated
  using (
    exists (
      select 1
      from public.family_tree_members m
      where m.tree_id = family_trees.id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'editor')
    )
  )
  with check (
    exists (
      select 1
      from public.family_tree_members m
      where m.tree_id = family_trees.id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'editor')
    )
  );

create policy "owners can manage members"
  on public.family_tree_members for all
  to authenticated
  using (
    exists (
      select 1
      from public.family_tree_members m
      where m.tree_id = family_tree_members.tree_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  )
  with check (
    exists (
      select 1
      from public.family_tree_members m
      where m.tree_id = family_tree_members.tree_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email, 'Family Tree User'),
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        email = excluded.email,
        avatar_url = excluded.avatar_url,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create or replace function public.handle_new_family_tree_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.family_tree_members (tree_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (tree_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists on_family_tree_created_owner on public.family_trees;
create trigger on_family_tree_created_owner
  after insert on public.family_trees
  for each row execute function public.handle_new_family_tree_owner();
