const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../bot');
function setup(initial) {
  let data = structuredClone(initial), writes = 0;
  const module = {exports:{}};
  const storage = {getJson:async()=>structuredClone(data),putJson:async(_,key,value)=>{
    assert.equal(key,'sessions.json'); data=structuredClone(value); writes++; return true;
  }};
  storage.getJsonWithVersion=async()=>({data:structuredClone(data),etag:'version'});
  storage.putJsonIfVersion=async(c,k,v)=>storage.putJson(c,k,v);
  vm.runInNewContext(fs.readFileSync(path.join(root,'src/store.js'),'utf8'),{
    module,__dirname:path.join(root,'src'),require:name=>name==='./config'?{s3:{bucket:'test'}}:name==='./objectStorage'?storage:require(name)
  });
  return {store:module.exports,read:()=>data,writes:()=>writes};
}
test('expired and undated legacy drafts are removed, active draft survives',async()=>{
  const now=Date.now();
  const env=setup({old:{step:'admin_edit',updatedAt:new Date(now-25*3600000).toISOString()},
    legacy:{step:'admin_edit',phone:'SYNTHETIC'},
    active:{step:'admin_edit',updatedAt:new Date(now-3600000).toISOString(),draft:'keep'}});
  assert.equal((await env.store.getSession('old')).step,'idle');
  assert.equal(env.read().legacy,undefined);
  assert.equal((await env.store.getSession('active')).draft,'keep');
  assert.equal(env.writes(),1);
});
test('saving updates time and retains other active administrative drafts',async()=>{
  const env=setup({other:{step:'admin_edit',updatedAt:new Date().toISOString()}});
  await env.store.setSession('owner',{step:'admin_title',draft:'flowers'});
  assert.equal(env.read().owner.draft,'flowers');
  assert.ok(Date.now()-Date.parse(env.read().owner.updatedAt)<10000);
  assert.equal(env.read().other.step,'admin_edit');
  await env.store.clearSession('owner');
  assert.equal(env.read().owner,undefined);
  assert.equal(env.read().other.step,'admin_edit');
});
test('failed pruning write does not pretend physical deletion succeeded',async()=>{
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'src/store.js'),'utf8'),{
    module,__dirname:path.join(root,'src'),require:n=>n==='./config'?{s3:{bucket:'test'}}:n==='./objectStorage'?{
      getJsonWithVersion:async()=>({data:{legacy:{step:'admin'}},etag:'version'}),
      putJsonIfVersion:async()=>{throw Error('WRITE_FAILED');}
    }:require(n)
  });
  await assert.rejects(module.exports.getSession('legacy'));
});
test('scheduled cleanup preserves a draft concurrently renewed by the bot',async()=>{
  let data={owner:{step:'admin_edit',updatedAt:new Date(Date.now()-25*3600000).toISOString()}},writes=0;
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'src/store.js'),'utf8'),{
    module,__dirname:path.join(root,'src'),require:n=>n==='./config'?{s3:{bucket:'test'}}:n==='./objectStorage'?{
      getJsonWithVersion:async()=>({data:structuredClone(data),etag:String(writes)}),
      putJsonIfVersion:async()=>{
        writes++;data={owner:{step:'admin_edit',draft:'renewed',updatedAt:new Date().toISOString()}};
        const error=Error('concurrent write');error.code='STORAGE_VERSION_CONFLICT';throw error;
      }
    }:require(n)
  });
  assert.equal((await module.exports.cleanupExpiredSessions()).removed,0);
  assert.equal(data.owner.draft,'renewed');assert.equal(writes,1);
});
test('timer pruning works without an incoming bot message and is idempotent',async()=>{
  const env=setup({legacy:{step:'admin'},active:{step:'admin',updatedAt:new Date().toISOString()}});
  assert.equal((await env.store.cleanupExpiredSessions()).removed,1);
  assert.equal((await env.store.cleanupExpiredSessions()).removed,0);
  assert.equal(env.writes(),1);assert.ok(env.read().active);
});
test('deployed source diagnostic calls contain fixed strings only',()=>{
  for(const file of ['index.js',...fs.readdirSync(path.join(root,'src')).filter(n=>n.endsWith('.js')).map(n=>'src/'+n)]){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const call of source.matchAll(/console\.(?:log|warn|error)\(([^\n]*)\);/g)){
      assert.match(call[1],/^'[^']*'$/,file+': diagnostics must not include data or exceptions');
    }
  }
});
