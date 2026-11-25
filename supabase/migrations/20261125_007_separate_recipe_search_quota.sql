-- Published-recipe searches have their own quota; never deplete original-recipe generations.
alter table public.family_ai_usage add column if not exists search_count integer not null default 0
 check(search_count>=0 and search_count<=6);
create or replace function private.reserve_family_search_internal(p_household uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 if auth.uid() is null or not private.is_family_member(p_household) then raise exception 'Not authorized'; end if;
 insert into public.family_ai_usage(household_id,user_id,usage_date,request_count,search_count)
 values(p_household,auth.uid(),(now() at time zone 'utc')::date,0,1)
 on conflict(household_id,user_id,usage_date) do update
 set search_count=public.family_ai_usage.search_count+1
 where public.family_ai_usage.search_count<6
 returning search_count into v_count;
 if v_count is null then raise exception 'DAILY_SEARCH_LIMIT'; end if;
 return v_count;
end; $$;
revoke all on function private.reserve_family_search_internal(uuid) from public,anon;
grant execute on function private.reserve_family_search_internal(uuid) to authenticated;
create or replace function public.reserve_family_recipe_search(p_household uuid)
returns integer language sql security invoker set search_path='' as $$
 select private.reserve_family_search_internal(p_household);
$$;
revoke all on function public.reserve_family_recipe_search(uuid) from public,anon;
grant execute on function public.reserve_family_recipe_search(uuid) to authenticated;