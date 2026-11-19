-- Tighten internal membership helpers; keep only authenticated family actions in the public API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.is_family_member(p_household uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
 select exists(select 1 from public.family_members m
 where m.household_id = p_household and m.user_id = (select auth.uid()));
$$;
create function private.is_family_owner(p_household uuid)
returns boolean language sql stable security definer
set search_path = '' as $$
 select exists(select 1 from public.family_members m
 where m.household_id = p_household and m.user_id = (select auth.uid()) and m.role = 'owner');
$$;
revoke all on function private.is_family_member(uuid), private.is_family_owner(uuid) from public, anon;
grant execute on function private.is_family_member(uuid), private.is_family_owner(uuid) to authenticated;

alter policy "Members read their household" on public.family_households using (private.is_family_member(id));
alter policy "Members read membership" on public.family_members using (private.is_family_member(household_id));
alter policy "Members read their plan" on public.family_plans using (private.is_family_member(household_id));
alter policy "Members create their plan" on public.family_plans with check (private.is_family_member(household_id));
alter policy "Members edit their plan" on public.family_plans using (private.is_family_member(household_id)) with check (private.is_family_member(household_id));
alter policy "Members read recipes" on public.family_recipes using (private.is_family_member(household_id));
alter policy "Members add recipes" on public.family_recipes with check (private.is_family_member(household_id));
alter policy "Members edit recipes" on public.family_recipes using (private.is_family_member(household_id)) with check (private.is_family_member(household_id));
alter policy "Members remove recipes" on public.family_recipes using (private.is_family_member(household_id));
alter policy "Owners read invitations" on public.family_invites using (private.is_family_owner(household_id));

create or replace function public.invite_family_member(p_household uuid,p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_code uuid; v_email text := lower(trim(p_email));
begin
 if not private.is_family_owner(p_household) then raise exception 'Only the household owner may invite'; end if;
 if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 then raise exception 'Invalid email'; end if;
 insert into public.family_invites(household_id,invitee_email,created_by)
 values(p_household,v_email,auth.uid()) returning code into v_code;
 return v_code;
end;$$;

drop function public.is_family_member(uuid);
drop function public.is_family_owner(uuid);

revoke all on public.family_households, public.family_members, public.family_plans,
 public.family_recipes, public.family_invites from anon;
revoke all on public.family_households, public.family_members, public.family_plans,
 public.family_recipes, public.family_invites from public;
