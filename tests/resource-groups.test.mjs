import assert from 'node:assert/strict'
import test from 'node:test'
import { groupCloudImages } from '../src/resourceGroups.ts'
const sha = 'a'.repeat(64)
const legacy = (path, hash=sha) => ({sha:hash,bucket:'images',path,name:path,mime:'image/png',size:10,folder:'',created_at:''})
const priv = {sha,bucket:'atlas-private-resources',path:'owner/'+sha,mime:'image/png',size:10,created_at:'',documents:[],trash:[]}
test('identical SHA: one card, every physical copy preserved in the group',()=>{
  const rows=groupCloudImages([legacy('a.png'),legacy('b.png')],[priv])
  assert.equal(rows.length,1);assert.equal(rows[0].public.length,2);assert.equal(rows[0].private,priv)
})
test('unindexed historical objects are not guessed to be duplicates',()=>{
  assert.equal(groupCloudImages([legacy('a.png',null),legacy('b.png',null)],[priv]).length,3)
})
test('an unused private file remains visible without any document',()=>{
  assert.equal(groupCloudImages([], [priv]).length,1)
  assert.equal(groupCloudImages([], [priv])[0].private.documents.length,0)
})
