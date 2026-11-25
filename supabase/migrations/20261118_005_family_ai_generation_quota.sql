-- Server-side AI requests are limited to three generations per signed-in family member per UTC day.
create table if not exists public.family_ai_usage (
 household_id uuid not null references public.family_households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 usage_date date not null default (now() at time zone 'utc')::date,
 request_count integer not null default 0 check (request_count >= 0 and request_count <= 3),
 primary key(household_id,user_id,usage_date)
);
alter table public.family_ai_usage enable row level security;
create policy "Members read own AI usage" on public.family_ai_usage
 for select to authenticated using(user_id=(select auth.uid()) and private.is_family_member(household_id));
create policy "Members insert own AI usage" on public.family_ai_usage
 for insert to authenticated with check(user_id=(select auth.uid()) and private.is_family_member(household_id));
create policy "Members update own AI usage" on public.family_ai_usage
 for update to authenticated using(user_id=(select auth.uid()) and private.is_family_member(household_id))
 with check(user_id=(select auth.uid()) and private.is_family_member(household_id));
grant select,insert,update on public.family_ai_usage to authenticated;
create or replace function public.reserve_family_ai_generation(p_household uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if auth.uid() is null or not private.is_family_member(p_household) then
  raise exception 'Not authorized';
 end if;
 insert into public.family_ai_usage(household_id,user_id,usage_date,request_count)
 values(p_household,auth.uid(),(now() at time zone 'utc')::date,1)
 on conflict(household_id,user_id,usage_date) do update
 set request_count=public.family_ai_usage.request_count+1
 where public.family_ai_usage.request_count<3
 returning request_count into v_count;
 if v_count is null then raise exception 'DAILY_AI_LIMIT'; end if;
 return v_count;
end; $$;
revoke all on function public.reserve_family_ai_generation(uuid) from public,anon;
grant execute on function public.reserve_family_ai_generation(uuid) to authenticated;