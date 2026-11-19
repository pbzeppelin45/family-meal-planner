-- Keep quota writes off the public Data API. Only an authenticated invoker wrapper is exposed.
revoke all on public.family_ai_usage from authenticated, anon, public;
create or replace function private.reserve_family_ai_generation_internal(p_household uuid)
returns integer language plpgsql security definer set search_path='' as $$
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
revoke all on function private.reserve_family_ai_generation_internal(uuid) from public, anon;
grant execute on function private.reserve_family_ai_generation_internal(uuid) to authenticated;
create or replace function public.reserve_family_ai_generation(p_household uuid)
returns integer language sql security invoker set search_path='' as $$
 select private.reserve_family_ai_generation_internal(p_household);
$$;
revoke all on function public.reserve_family_ai_generation(uuid) from public, anon;
grant execute on function public.reserve_family_ai_generation(uuid) to authenticated;
