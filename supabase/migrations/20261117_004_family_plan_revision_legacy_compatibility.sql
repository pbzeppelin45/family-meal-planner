-- Compatibility with original manual-save preview that sends no revision.
create or replace function private.bump_family_plan_revision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.revision <= old.revision then new.revision := old.revision + 1; end if;
 return new;
end; $$;
drop trigger if exists family_plan_revision_fallback on public.family_plans;
create trigger family_plan_revision_fallback before update on public.family_plans
for each row execute function private.bump_family_plan_revision();
