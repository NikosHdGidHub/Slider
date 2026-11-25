-- Укажите тот же User UID владельца, что в VITE_ADMIN_UUID.
begin;
create schema if not exists atlas_transfer_private;
revoke all on schema atlas_transfer_private from public, anon, authenticated;

create table if not exists atlas_transfer_private.requests (
  id uuid primary key default gen_random_uuid(),
  sender_hash text not null unique check (sender_hash ~ '^[0-9a-f]{64}$'),
  receiver_hash text not null unique check (receiver_hash ~ '^[0-9a-f]{64}$'),
  code text not null check (code ~ '^[0-9A-F]{6}$'),
  source_hash text,
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at = created_at + interval '120 seconds'),
  next_poll_at timestamptz not null default '-infinity',
  publication_id uuid,
  state text not null default 'waiting' check (state in ('waiting','sent','received','canceled')),
  check ((state = 'sent') = (publication_id is not null)),
  check (sender_hash <> receiver_hash)
);
alter table atlas_transfer_private.requests enable row level security;
revoke all on atlas_transfer_private.requests from public, anon, authenticated;

create or replace function atlas_transfer_private.owner_allowed()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    auth.role() = 'authenticated' and
    auth.uid() = '43649fda-26cb-4b20-bbc1-0a398e9d8ce3'::uuid,
    false
  );
$$;

create or replace function atlas_transfer_private.token_hash(token text)
returns text language sql immutable strict set search_path = '' as $$
  select case when token ~ '^[0-9a-f]{64}$'
    then encode(sha256(convert_to(token, 'UTF8')), 'hex') end;
$$;

create or replace function atlas_transfer_private.publication_exists(publication uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from storage.objects o
    join storage.buckets b on b.id = o.bucket_id
    where b.id = 'presentations' and b.public
      and o.name = publication::text || '.json'
  );
$$;

create or replace function public.atlas_transfer_start(sender_hash text, receiver_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  source text;
  source_id text;
  instant timestamptz;
  request atlas_transfer_private.requests%rowtype;
begin
  if sender_hash is null or sender_hash !~ '^[0-9a-f]{64}$' or
     receiver_hash is null or receiver_hash !~ '^[0-9a-f]{64}$' or
     sender_hash = receiver_hash then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- An address is a hint from the gateway. The global limit also applies
  -- without it and cannot be lifted by changing the address.
  source := coalesce(headers->>'cf-connecting-ip', headers->>'x-real-ip');
  if source ~ '^[0-9A-Fa-f.:]{1,45}$' then
    source_id := encode(sha256(convert_to(source, 'UTF8')), 'hex');
  end if;
  perform pg_advisory_xact_lock(7194033, 120);
  instant := clock_timestamp();
  delete from atlas_transfer_private.requests r where r.expires_at <= instant;
  if (select count(*) from atlas_transfer_private.requests r
      where r.created_at > instant - interval '60 seconds') >= 60
    or (source_id is not null and
      (select count(*) from atlas_transfer_private.requests r
       where r.source_hash = source_id and r.created_at > instant - interval '60 seconds') >= 12)
  then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into atlas_transfer_private.requests
    (sender_hash, receiver_hash, code, source_hash, created_at, expires_at)
  values (sender_hash, receiver_hash, upper(left(gen_random_uuid()::text, 6)),
          source_id, instant, instant + interval '120 seconds')
  on conflict do nothing returning * into request;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  return jsonb_build_object('status', 'waiting', 'id', request.id,
                            'code', request.code, 'remaining_ms', 120000);
end;
$$;

create or replace function public.atlas_transfer_inspect(request_id uuid, sender_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request atlas_transfer_private.requests%rowtype;
  remaining integer;
begin
  if not atlas_transfer_private.owner_allowed() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into request from atlas_transfer_private.requests r
  where r.id = request_id and r.sender_hash = atlas_transfer_private.token_hash(sender_token);
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  remaining := floor(extract(epoch from (request.expires_at - clock_timestamp())) * 1000);
  if remaining <= 0 then return jsonb_build_object('status', 'expired'); end if;
  if request.state = 'canceled' then return jsonb_build_object('status', 'canceled'); end if;
  if request.state <> 'waiting' then return jsonb_build_object('status', 'used'); end if;
  return jsonb_build_object('status', 'waiting', 'code', request.code, 'remaining_ms', remaining);
end;
$$;

create or replace function public.atlas_transfer_send(request_id uuid, sender_token text, publication_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request atlas_transfer_private.requests%rowtype;
begin
  if not atlas_transfer_private.owner_allowed() then
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into request from atlas_transfer_private.requests r
  where r.id = request_id and r.sender_hash = atlas_transfer_private.token_hash(sender_token)
  for update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if request.expires_at <= clock_timestamp() then return jsonb_build_object('status', 'expired'); end if;
  if request.state = 'canceled' then return jsonb_build_object('status', 'canceled'); end if;
  if request.state <> 'waiting' then return jsonb_build_object('status', 'used'); end if;
  if not atlas_transfer_private.publication_exists(publication_id) then
    return jsonb_build_object('status', 'missing_publication');
  end if;
  update atlas_transfer_private.requests
  set state = 'sent', publication_id = atlas_transfer_send.publication_id
  where id = request.id;
  return jsonb_build_object('status', 'sent');
end;
$$;

create or replace function public.atlas_transfer_poll(request_id uuid, receiver_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request atlas_transfer_private.requests%rowtype;
  instant timestamptz;
begin
  select * into request from atlas_transfer_private.requests r
  where r.id = request_id and r.receiver_hash = atlas_transfer_private.token_hash(receiver_token)
  for update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  instant := clock_timestamp();
  if request.expires_at <= instant then return jsonb_build_object('status', 'expired'); end if;
  if request.state = 'canceled' then return jsonb_build_object('status', 'canceled'); end if;
  if request.state = 'received' then return jsonb_build_object('status', 'used'); end if;
  if request.next_poll_at > instant then return jsonb_build_object('status', 'rate_limited'); end if;
  if request.state = 'waiting' then
    update atlas_transfer_private.requests set next_poll_at = instant + interval '2 seconds'
    where id = request.id;
    return jsonb_build_object('status', 'waiting');
  end if;
  update atlas_transfer_private.requests set state = 'received', publication_id = null where id = request.id;
  if not atlas_transfer_private.publication_exists(request.publication_id) then
    return jsonb_build_object('status', 'missing_publication');
  end if;
  return jsonb_build_object('status', 'received', 'publication_id', request.publication_id);
end;
$$;

create or replace function public.atlas_transfer_cancel(request_id uuid, receiver_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update atlas_transfer_private.requests r set state = 'canceled', publication_id = null
  where r.id = request_id and r.receiver_hash = atlas_transfer_private.token_hash(receiver_token)
    and r.state in ('waiting','sent') and r.expires_at > clock_timestamp();
  return jsonb_build_object('status', case when found then 'canceled' else 'invalid' end);
end;
$$;

revoke all on all functions in schema atlas_transfer_private from public, anon, authenticated;
revoke all on function public.atlas_transfer_start(text,text), public.atlas_transfer_poll(uuid,text),
  public.atlas_transfer_cancel(uuid,text), public.atlas_transfer_inspect(uuid,text),
  public.atlas_transfer_send(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.atlas_transfer_start(text,text), public.atlas_transfer_poll(uuid,text),
  public.atlas_transfer_cancel(uuid,text) to anon, authenticated;
grant execute on function public.atlas_transfer_inspect(uuid,text),
  public.atlas_transfer_send(uuid,text,uuid) to authenticated;
commit;
