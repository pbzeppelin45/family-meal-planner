-- Revision-checked saves to prevent lost updates across devices.
alter table public.family_plans add column if not exists revision bigint not null default 0;
create or replace function public.save_family_plan(p_household uuid,p_state jsonb,p_expected_revision bigint)
returns bigint language plpgsql security invoker set search_path='' as $$
declare v_revision bigint;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_state is null or jsonb_typeof(p_state) <> 'object' then raise exception 'Invalid plan'; end if;
 if pg_catalog.octet_length(p_state::text) > 131072 then raise exception 'Plan too large'; end if;
 update public.family_plans
 set state=p_state,revision=revision+1,updated_by=auth.uid(),updated_at=now()
 where household_id=p_household and revision=p_expected_revision
 returning revision into v_revision;
 if v_revision is null then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 return v_revision;
end; $$;
revoke all on function public.save_family_plan(uuid,jsonb,bigint) from public, anon;
grant execute on function public.save_family_plan(uuid,jsonb,bigint) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='family_plans') then
  alter publication supabase_realtime add table public.family_plans;
 end if;
end $$;
create index if not exists idx_family_invites_household on public.family_invites(household_id);
