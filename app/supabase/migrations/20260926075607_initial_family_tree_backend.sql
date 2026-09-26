-- Canonical baseline for the Family Tree backend. Generated with
-- `supabase migration new initial_family_tree_backend` and reconciled with
-- the already-running project on 2026-09-26.

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

create table if not exists public.family_tree_invitations (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  invited_email text not null,
  role public.family_tree_role not null default 'viewer',
  invited_by uuid not null references auth.users (id) on delete cascade,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_tree_invitations_role_check check (role in ('editor', 'viewer')),
  constraint family_tree_invitations_email_check check (length(trim(invited_email)) > 3),
  unique (tree_id, invited_email)
);

create table if not exists public.github_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.github_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  github_user_id bigint not null,
  github_login text not null,
  avatar_url text,
  profile_url text not null,
  access_token_ciphertext text not null,
  access_token_nonce text not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (github_user_id)
);

create table if not exists public.tree_publish_targets (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  github_connection_id uuid not null references public.github_connections (id) on delete cascade,
  repo_owner text not null,
  repo_name text not null,
  branch text not null default 'main',
  output_path text not null default '/',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  pages_url text,
  last_published_at timestamptz,
  last_commit_sha text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tree_id, owner_id)
);

create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references public.family_trees (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  target_id uuid references public.tree_publish_targets (id) on delete set null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  message text,
  commit_sha text,
  pages_url text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.family_trees enable row level security;
alter table public.family_tree_members enable row level security;
alter table public.family_tree_invitations enable row level security;
alter table public.github_oauth_states enable row level security;
alter table public.github_connections enable row level security;
alter table public.tree_publish_targets enable row level security;
alter table public.publish_jobs enable row level security;

create unique index if not exists profiles_email_lower_idx on public.profiles (lower(email));
create unique index if not exists family_tree_invitations_tree_email_lower_idx
  on public.family_tree_invitations (tree_id, lower(invited_email));
create index if not exists github_oauth_states_user_expires_idx on public.github_oauth_states (user_id, expires_at);
create index if not exists tree_publish_targets_owner_idx on public.tree_publish_targets (owner_id);
create index if not exists publish_jobs_tree_created_idx on public.publish_jobs (tree_id, created_at desc);

create or replace function public.current_user_has_tree_role(
  target_tree_id uuid,
  allowed_roles public.family_tree_role[]
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.family_tree_members m
    where m.tree_id = target_tree_id
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

create or replace function public.current_user_is_tree_member(target_tree_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_has_tree_role(
    target_tree_id,
    array['owner', 'editor', 'viewer']::public.family_tree_role[]
  );
$$;

create or replace function public.current_user_invited_to_tree(target_tree_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.family_tree_invitations invitation
    where invitation.tree_id = target_tree_id
      and invitation.accepted_at is null
      and lower(invitation.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.accept_pending_family_tree_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or current_email = '' then
    return;
  end if;

  insert into public.family_tree_members (tree_id, user_id, role, invited_email)
  select invitation.tree_id, auth.uid(), invitation.role, invitation.invited_email
  from public.family_tree_invitations invitation
  where invitation.accepted_at is null
    and lower(invitation.invited_email) = current_email
  on conflict (tree_id, user_id) do update
    set role = case
      when public.family_tree_members.role = 'owner' then public.family_tree_members.role
      else excluded.role
    end,
    invited_email = excluded.invited_email;

  update public.family_tree_invitations invitation
  set accepted_by = auth.uid(),
      accepted_at = now(),
      updated_at = now()
  where invitation.accepted_at is null
    and lower(invitation.invited_email) = current_email;
end;
$$;

create or replace function public.invite_family_tree_member(
  target_tree_id uuid,
  invite_email text,
  invite_role public.family_tree_role
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(invite_email));
  matched_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to share a tree.';
  end if;

  if not public.current_user_has_tree_role(target_tree_id, array['owner']::public.family_tree_role[]) then
    raise exception 'Only the tree owner can manage sharing.';
  end if;

  if invite_role not in ('editor', 'viewer') then
    raise exception 'Shared users can only be editors or viewers.';
  end if;

  if normalized_email = '' or position('@' in normalized_email) < 2 then
    raise exception 'Enter a valid email address.';
  end if;

  select id into matched_user_id
  from public.profiles
  where lower(email) = normalized_email
  limit 1;

  if matched_user_id is not null then
    insert into public.family_tree_members (tree_id, user_id, role, invited_email)
    values (target_tree_id, matched_user_id, invite_role, normalized_email)
    on conflict (tree_id, user_id) do update
      set role = case
        when public.family_tree_members.role = 'owner' then public.family_tree_members.role
        else excluded.role
      end,
      invited_email = excluded.invited_email;

    update public.family_tree_invitations
    set accepted_by = matched_user_id,
        accepted_at = coalesce(accepted_at, now()),
        updated_at = now()
    where tree_id = target_tree_id
      and lower(invited_email) = normalized_email;

    return 'member';
  end if;

  insert into public.family_tree_invitations (tree_id, invited_email, role, invited_by)
  values (target_tree_id, normalized_email, invite_role, auth.uid())
  on conflict (tree_id, invited_email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        accepted_by = null,
        accepted_at = null,
        updated_at = now();

  return 'invitation';
end;
$$;

drop policy if exists "profiles are readable by signed in users" on public.profiles;
drop policy if exists "users can update their own profile" on public.profiles;
drop policy if exists "members can read their tree memberships" on public.family_tree_members;
drop policy if exists "members can read family trees" on public.family_trees;
drop policy if exists "owners can create family trees" on public.family_trees;
drop policy if exists "owners and editors can update family trees" on public.family_trees;
drop policy if exists "owners can manage members" on public.family_tree_members;
drop policy if exists "owners can manage invitations" on public.family_tree_invitations;
drop policy if exists "invited users can read invitations" on public.family_tree_invitations;
drop policy if exists "owners can read publish targets" on public.tree_publish_targets;
drop policy if exists "owners can read publish jobs" on public.publish_jobs;

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
  using (
    user_id = auth.uid()
    or public.current_user_has_tree_role(
      tree_id,
      array['owner']::public.family_tree_role[]
    )
  );

create policy "members can read family trees"
  on public.family_trees for select
  to authenticated
  using (public.current_user_is_tree_member(id));

create policy "owners can create family trees"
  on public.family_trees for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners and editors can update family trees"
  on public.family_trees for update
  to authenticated
  using (
    public.current_user_has_tree_role(
      id,
      array['owner', 'editor']::public.family_tree_role[]
    )
  )
  with check (
    public.current_user_has_tree_role(
      id,
      array['owner', 'editor']::public.family_tree_role[]
    )
  );

create policy "owners can manage members"
  on public.family_tree_members for all
  to authenticated
  using (
    public.current_user_has_tree_role(
      tree_id,
      array['owner']::public.family_tree_role[]
    )
  )
  with check (
    public.current_user_has_tree_role(
      tree_id,
      array['owner']::public.family_tree_role[]
    )
  );

create policy "owners can manage invitations"
  on public.family_tree_invitations for all
  to authenticated
  using (
    public.current_user_has_tree_role(
      tree_id,
      array['owner']::public.family_tree_role[]
    )
  )
  with check (
    public.current_user_has_tree_role(
      tree_id,
      array['owner']::public.family_tree_role[]
    )
  );

create policy "invited users can read invitations"
  on public.family_tree_invitations for select
  to authenticated
  using (
    accepted_at is null
    and lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "owners can read publish targets"
  on public.tree_publish_targets for select
  to authenticated
  using (
    public.current_user_has_tree_role(
      tree_id,
      array['owner']::public.family_tree_role[]
    )
  );

create policy "owners can read publish jobs"
  on public.publish_jobs for select
  to authenticated
  using (
    public.current_user_has_tree_role(
      tree_id,
      array['owner']::public.family_tree_role[]
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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-tree-photos', 'family-tree-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tree members can read family photos" on storage.objects;
create policy "tree members can read family photos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and public.current_user_is_tree_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "tree editors can upload family photos" on storage.objects;
create policy "tree editors can upload family photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'family-tree-photos'
    and public.current_user_has_tree_role(
      (storage.foldername(name))[1]::uuid,
      array['owner', 'editor']::public.family_tree_role[]
    )
  );

drop policy if exists "tree editors can update family photos" on storage.objects;
create policy "tree editors can update family photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and public.current_user_has_tree_role(
      (storage.foldername(name))[1]::uuid,
      array['owner', 'editor']::public.family_tree_role[]
    )
  )
  with check (
    bucket_id = 'family-tree-photos'
    and public.current_user_has_tree_role(
      (storage.foldername(name))[1]::uuid,
      array['owner', 'editor']::public.family_tree_role[]
    )
  );

drop policy if exists "tree editors can delete family photos" on storage.objects;
create policy "tree editors can delete family photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'family-tree-photos'
    and public.current_user_has_tree_role(
      (storage.foldername(name))[1]::uuid,
      array['owner', 'editor']::public.family_tree_role[]
    )
  );

create or replace function public.current_user_shares_tree_with(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.family_tree_members mine
    join public.family_tree_members theirs on theirs.tree_id = mine.tree_id
    where mine.user_id = auth.uid()
      and theirs.user_id = target_user_id
  );
$$;

drop policy if exists "profiles are readable by signed in users" on public.profiles;
create policy "profiles are readable by tree collaborators"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.current_user_shares_tree_with(id));

revoke all on function public.current_user_has_tree_role(uuid, public.family_tree_role[]) from public, anon;
revoke all on function public.current_user_is_tree_member(uuid) from public, anon;
revoke all on function public.current_user_invited_to_tree(uuid) from public, anon;
revoke all on function public.current_user_shares_tree_with(uuid) from public, anon;
revoke all on function public.accept_pending_family_tree_invites() from public, anon;
revoke all on function public.invite_family_tree_member(uuid, text, public.family_tree_role) from public, anon;
grant execute on function public.current_user_has_tree_role(uuid, public.family_tree_role[]) to authenticated;
grant execute on function public.current_user_is_tree_member(uuid) to authenticated;
grant execute on function public.current_user_invited_to_tree(uuid) to authenticated;
grant execute on function public.current_user_shares_tree_with(uuid) to authenticated;
grant execute on function public.accept_pending_family_tree_invites() to authenticated;
grant execute on function public.invite_family_tree_member(uuid, text, public.family_tree_role) to authenticated;

revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
revoke all on function public.handle_new_family_tree_owner() from public, anon, authenticated;
