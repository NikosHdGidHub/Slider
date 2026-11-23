-- Run in a disposable PostgreSQL database with templates.sql applied and auth.uid()
-- reading request.jwt.claim.sub. The matching users must already exist.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '43649fda-26cb-4b20-bbc1-0a398e9d8ce3';
insert into public.atlas_templates(id,revision,document) values
 ('00000000-0000-4000-8000-000000000007',1,'{"deck":{"id":"00000000-0000-4000-8000-000000000007"}}');
update public.atlas_templates set revision=2 where revision=1;
do $$begin if not exists(select from public.atlas_templates where revision=2) then raise exception 'owner update failed';end if;end$$;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000008';
do $$begin
 if exists(select from public.atlas_templates) then raise exception 'private data visible';end if;
 update public.atlas_templates set revision=4;
 if found then raise exception 'foreign update';end if;
 delete from public.atlas_templates;
 if found then raise exception 'foreign delete';end if;
 begin
  insert into public.atlas_templates(id,revision,document) values ('00000000-0000-4000-8000-000000000008',1,'{"deck":{"id":"00000000-0000-4000-8000-000000000008"}}');
  raise exception 'foreign insert';
 exception when insufficient_privilege then null;end;
end$$;
set local role anon;
do $$begin
 begin perform * from public.atlas_templates;raise exception 'guest can list';exception when insufficient_privilege then null;end;
end$$;
set local role authenticated;
set local request.jwt.claim.sub = '43649fda-26cb-4b20-bbc1-0a398e9d8ce3';
do $$begin delete from public.atlas_templates where revision=2;if not found then raise exception 'owner delete failed';end if;end$$;
rollback;
