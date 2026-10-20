const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function client(config,fetch) {
 const sandbox={module:{exports:{}},require:n=>n==='./config'?config:require(n),URL,Buffer,AbortSignal,fetch};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../bot/src/catalogClient.js'),'utf8'),sandbox);return sandbox.module.exports;
}
const config={regCatalogUrl:'https://shop.test/api/v1/catalog.php',regCatalogSecret:'a'.repeat(64)},version='"'+'b'.repeat(64)+'"';
test('catalogue client sends secret only for writes, pins origin and retains operation identity',async()=>{
 const calls=[],api=client(config,async(url,options)=>{calls.push({url:String(url),...options});return new Response(JSON.stringify(options.method==='GET'?{}:{ok:true}),{headers:{'x-catalog-version':version,etag:'"rewritten-gzip"'}})});
 assert.equal((await api.getJsonWithVersion()).etag,version);
 assert.equal(calls[0].headers.Authorization,undefined);
 await api.putJsonIfVersion(null,null,{a:[]},version);await api.putJsonIfVersion(null,null,{a:[]},version);
 assert.equal(calls[1].headers.Authorization,'Bearer '+config.regCatalogSecret);
 assert.equal(calls[1].headers['X-ZT-Catalog-Key'],config.regCatalogSecret);
 assert.equal(calls[1].headers['If-Match'],version);
 assert.equal(calls[1].headers['Idempotency-Key'],calls[2].headers['Idempotency-Key']);
 assert.equal(calls[1].redirect,'error');
});
test('misconfiguration, failed writes and foreign photo URLs never confirm success',async()=>{
 for(const regCatalogUrl of ['http://shop.test/api','https://user:pass@shop.test/api','https://shop.test/api?secret=x']) {
  const api=client({...config,regCatalogUrl},async()=>{throw Error('must not call network')});await assert.rejects(api.getJsonWithVersion(),/HTTPS/);
 }
 const noSecret=client({...config,regCatalogSecret:''},async()=>{throw Error('must not call network')});await assert.rejects(noSecret.putJsonIfVersion(null,null,{},version),/secret missing/);
 for(const status of [403,409,500,503]) {
  const api=client(config,async()=>new Response('{}',{status}));await assert.rejects(api.putJsonIfVersion(null,null,{},version));
 }
 const falseAck=client(config,async()=>new Response('{"ok":false}'));await assert.rejects(falseAck.putJsonIfVersion(null,null,{},version),/not confirmed/);
 const foreign=client(config,async()=>new Response('{"ok":true,"url":"https://other.test/assets/catalog/x.jpg"}'));await assert.rejects(foreign.uploadPhoto(Buffer.from('x'),'image/jpeg'),/Unexpected photo URL/);
});
