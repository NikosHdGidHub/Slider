import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const owner='10000000-0000-4000-8000-000000000001'
const other='10000000-0000-4000-8000-000000000002'
const token='10000000-0000-4000-8000-000000000003'
const doc='10000000-0000-4000-8000-000000000004'
const sha='ab'.repeat(32), path=owner+'/'+sha
const sql=name=>readFileSync(new URL('../supabase/'+name+'.sql',import.meta.url),'utf8')
test('private deletion reservation protects documents, rejects foreign owner and stale writes, then allows reuse',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      grant usage on schema auth,storage to anon,authenticated;
      create table public.atlas_course_access(owner_id uuid primary key);
      insert into public.atlas_course_access values('${owner}'),('${other}');
      create function public.atlas_working_allowed(expected_owner uuid) returns boolean language sql stable security definer set search_path='' as $$select expected_owner is not null and expected_owner=auth.uid() and exists(select 1 from public.atlas_course_access where owner_id=expected_owner)$$;
      create table public.atlas_working_documents(owner_id uuid,kind text,id uuid,title text,document jsonb,resource_refs text[],deleted_at timestamptz,primary key(owner_id,kind,id));
      create table public.atlas_publication_locks(id uuid primary key,token uuid,expires_at timestamptz);
      create table storage.objects(bucket_id text,name text,metadata jsonb default '{}',created_at timestamptz default now(),primary key(bucket_id,name));
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to anon,authenticated;
      create policy broad on storage.objects for all to public using(true) with check(true);
      insert into storage.objects(bucket_id,name,metadata) values('atlas-private-resources','${path}','{"mimetype":"image/png","size":10}');
      insert into public.atlas_publication_locks values('00000000-0000-4000-8000-000000000000','${token}',now()+interval '10 minutes');
      insert into public.atlas_working_documents values('${owner}','lesson','${doc}','Test','{}',array['${sha}'],null);
    `)
    await db.exec(sql('resource-library')); await db.exec(sql('resource-library-delete')); await db.exec(sql('resource-library-delete'))
    const role=async(uid)=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[uid]);await db.exec('set role authenticated')}
    const rpc=async(name,args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args)).rows[0].value
    const reserve=()=>rpc('atlas_resource_delete_begin',[owner,sha,token])
    await role(other);await assert.rejects(()=>reserve(),/owner required/)
    await role(owner);await assert.rejects(()=>reserve(),/используется/)
    const direct=await db.query("delete from storage.objects where bucket_id='atlas-private-resources' and name=$1 returning name",[path]);assert.equal(direct.rows.length,0)
    await db.exec('reset role');await db.exec(`update public.atlas_working_documents set deleted_at=now()`)
    await role(owner);await assert.rejects(()=>reserve(),/используется/)
    await db.exec('reset role');await db.exec("update public.atlas_working_documents set document=null,resource_refs='{}'")
    await role(owner);assert.equal(await reserve(),true)
    await assert.rejects(()=>reserve(),/не подтверждено/)
    await assert.rejects(()=>rpc('atlas_resource_delete_finish',[owner,sha,token]),/ещё существует/)
    await db.exec('reset role');await assert.rejects(()=>db.query("update public.atlas_working_documents set document='{}',resource_refs=array[$1::text]",[sha]),/зарезервирован/)
    await role(owner)
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-client-info':'atlas-storage/'+token})])
    const removed=await db.query("delete from storage.objects where bucket_id='atlas-private-resources' and name=$1 returning name",[path]);assert.equal(removed.rows.length,1)
    await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('atlas-private-resources',$1)",[path]),/row-level security/)
    assert.equal(await rpc('atlas_resource_delete_finish',[owner,sha,token]),true)
    await db.query("insert into storage.objects(bucket_id,name) values('atlas-private-resources',$1)",[path])
    const stale=await db.query("delete from storage.objects where bucket_id='atlas-private-resources' and name=$1 returning name",[path]);assert.equal(stale.rows.length,0)
    await db.exec('reset role');await db.query("update public.atlas_working_documents set document='{}',resource_refs=array[$1::text],deleted_at=null",[sha])
    await role(owner);await assert.rejects(()=>reserve(),/используется/)
  } finally { await db.close() }
})
