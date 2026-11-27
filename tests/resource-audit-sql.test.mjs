import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002'
const sha='ab'.repeat(32), missing='cd'.repeat(32), doc='10000000-0000-4000-8000-000000000004'
const sql=name=>readFileSync(new URL('../supabase/'+name+'.sql',import.meta.url),'utf8')
test('resource audit is owner-scoped, detects missing resources and reservations, protects public files',async()=>{
  const db=new PGlite()
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      grant usage on schema auth,storage to authenticated,anon;
      create table public.atlas_course_access(owner_id uuid primary key);
      insert into public.atlas_course_access values('${owner}'),('${other}');
      create function public.atlas_working_allowed(expected_owner uuid) returns boolean language sql stable security definer set search_path='' as $$select expected_owner is not null and expected_owner=auth.uid() and exists(select 1 from public.atlas_course_access where owner_id=expected_owner)$$;
      create table public.atlas_working_documents(owner_id uuid,kind text,id uuid,title text,document jsonb,resource_refs text[],deleted_at timestamptz,primary key(owner_id,kind,id));
      create table public.atlas_resource_delete_reservations(owner_id uuid,sha text,token uuid);
      create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
      alter table storage.objects enable row level security;grant select,delete on storage.objects to authenticated;
      create policy broad on storage.objects for all to public using(true) with check(true);
      insert into storage.objects values('images','historic.png'),('atlas-private-resources','${owner}/${sha}');
      insert into public.atlas_working_documents values('${owner}','lesson','${doc}','Old', '{"slides":[{"background":"https://example.org/a.png"}]}',array['${sha}','${missing}'],null),('${other}','lesson','${doc}','Foreign','{}',array['${missing}'],null);
      insert into public.atlas_resource_delete_reservations values('${owner}','${sha}','${doc}');`)
    await db.exec(sql('resource-library-audit'));await db.exec(sql('resource-library-audit'))
    const role=async(uid)=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[uid]);await db.exec('set role authenticated')}
    const audit=async(uid)=>(await db.query('select public.atlas_resource_audit($1) as value',[uid])).rows[0].value
    await role(other);await assert.rejects(()=>audit(owner),/owner required/)
    await role(owner);const result=await audit(owner)
    assert.equal(result.length,3);assert.equal(result.filter(x=>x.status==='error').length,2);assert.equal(result.filter(x=>x.status==='skipped').length,1)
    assert.ok(result.every(x=>x.title!=='Foreign'))
    const removed=await db.query("delete from storage.objects where bucket_id='images' returning name");assert.equal(removed.rows.length,0)
    await db.exec('reset role');const still=await db.query("select name from storage.objects where bucket_id='images'");assert.equal(still.rows.length,1)
  }finally{await db.close()}
})
