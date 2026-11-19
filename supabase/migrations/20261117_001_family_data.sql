-- Family Meal Planner: private family workspaces with account-based access.
-- Run in Supabase SQL editor / migration tool (requires project owner permissions).
create extension if not exists pgcrypto;

create table if not exists public.family_households (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 120),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table if not exists public.family_members (
 household_id uuid not null references public.family_households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','member')),
 created_at timestamptz not null default now(),
 primary key(household_id,user_id)
);
create table if not exists public.family_plans (
 household_id uuid primary key references public.family_households(id) on delete cascade,
 state jsonb not null default '{}'::jsonb check (jsonb_typeof(state)='object'),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
create table if not exists public.family_recipes (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.family_households(id) on delete cascade,
 title text not null,
 recipe jsonb not null check(jsonb_typeof(recipe)='object'),
 created_at timestamptz not null default now()
);
create table if not exists public.family_invites (
 code uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.family_households(id) on delete cascade,
 invitee_email text not null,
 created_by uuid not null references auth.users(id),
 expires_at timestamptz not null default (now() + interval '7 days'),
 accepted_at timestamptz
);

create index if not exists idx_family_members_user on public.family_members(user_id);
create index if not exists idx_family_recipes_household on public.family_recipes(household_id);

-- SECURITY DEFINER helpers avoid recursive household membership RLS evaluation.
create or replace function public.is_family_member(p_household uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
 select exists(select 1 from public.family_members m
 where m.household_id = p_household and m.user_id = (select auth.uid()));
$$;
create or replace function public.is_family_owner(p_household uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
 select exists(select 1 from public.family_members m
 where m.household_id = p_household and m.user_id = (select auth.uid()) and m.role='owner');
$$;

alter table public.family_households enable row level security;
alter table public.family_members enable row level security;
alter table public.family_plans enable row level security;
alter table public.family_recipes enable row level security;
alter table public.family_invites enable row level security;

create policy "Members read their household" on public.family_households for select to authenticated using (public.is_family_member(id));
create policy "Members read membership" on public.family_members for select to authenticated using (public.is_family_member(household_id));
create policy "Members read their plan" on public.family_plans for select to authenticated using (public.is_family_member(household_id));
create policy "Members create their plan" on public.family_plans for insert to authenticated with check (public.is_family_member(household_id));
create policy "Members edit their plan" on public.family_plans for update to authenticated using (public.is_family_member(household_id)) with check (public.is_family_member(household_id));
create policy "Members read recipes" on public.family_recipes for select to authenticated using (public.is_family_member(household_id));
create policy "Members add recipes" on public.family_recipes for insert to authenticated with check (public.is_family_member(household_id));
create policy "Members edit recipes" on public.family_recipes for update to authenticated using (public.is_family_member(household_id)) with check (public.is_family_member(household_id));
create policy "Members remove recipes" on public.family_recipes for delete to authenticated using (public.is_family_member(household_id));
create policy "Owners read invitations" on public.family_invites for select to authenticated using (public.is_family_owner(household_id));

-- Creation and invitation are managed via authenticated RPCs so direct table writes stay closed.
create or replace function public.create_family_household(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_user uuid := auth.uid();
begin
 if v_user is null then raise exception 'Sign in first'; end if;
 if length(trim(p_name)) not between 1 and 120 then raise exception 'Invalid household name'; end if;
 insert into public.family_households(name,created_by) values(trim(p_name),v_user) returning id into v_id;
 insert into public.family_members(household_id,user_id,role) values(v_id,v_user,'owner');
 insert into public.family_plans(household_id,state,updated_by) values(v_id,'{}'::jsonb,v_user);
 return v_id;
end;$$;

create or replace function public.invite_family_member(p_household uuid,p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_code uuid; v_email text:=lower(trim(p_email));
begin
 if not public.is_family_owner(p_household) then raise exception 'Only the household owner may invite'; end if;
 if length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Invalid email'; end if;
 insert into public.family_invites(household_id,invitee_email,created_by) values(p_household,v_email,auth.uid()) returning code into v_code;
 return v_code;
end;$$;

create or replace function public.accept_family_invite(p_code uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_inv public.family_invites%rowtype; v_email text:=lower(coalesce(auth.jwt()->>'email',''));
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into v_inv from public.family_invites where code=p_code for update;
 if not found or v_inv.accepted_at is not null or v_inv.expires_at <= now() then raise exception 'Invitation invalid or expired'; end if;
 if v_email <> v_inv.invitee_email then raise exception 'Invitation is for a different email account'; end if;
 insert into public.family_members(household_id,user_id,role)
 values(v_inv.household_id,auth.uid(),'member') on conflict do nothing;
 update public.family_invites set accepted_at=now() where code=p_code;
 return v_inv.household_id;
end;$$;

-- Restrict elevated functions to authenticated users.
revoke all on function public.is_family_member(uuid) from public,anon;
revoke all on function public.is_family_owner(uuid) from public,anon;
revoke all on function public.create_family_household(text) from public,anon;
revoke all on function public.invite_family_member(uuid,text) from public,anon;
revoke all on function public.accept_family_invite(uuid) from public,anon;
grant execute on function public.is_family_member(uuid), public.is_family_owner(uuid),
 public.create_family_household(text),public.invite_family_member(uuid,text),
 public.accept_family_invite(uuid) to authenticated;

-- Client-facing table privileges are gated by RLS policies above.
grant select on public.family_households, public.family_members to authenticated;
grant select,insert,update on public.family_plans to authenticated;
grant select,insert,update,delete on public.family_recipes to authenticated;
grant select on public.family_invites to authenticated;
