'use strict';
// Read-only verification: no database, network, deployment, bot execution or writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
process.chdir(path.resolve(__dirname,'..'));
const baseline=JSON.parse(fs.readFileSync('docs/stage1/unchanged-files.json','utf8'));
for(const [file,hash]of Object.entries(baseline))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash,'Protected file changed: '+file);
const snapshot=JSON.parse(fs.readFileSync('backend/orders/catalog.json','utf8'));
assert.equal(snapshot.products.length,53);assert.equal(snapshot.products.reduce((s,p)=>s+p.images.length,0),89);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync('backend/orders/consent.html')).digest('hex'),snapshot.consentTextSha256);
const index=fs.readFileSync('index.html','utf8');
const scripts=[...index.matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"[^>]*>/g)].map(x=>x[1]);
assert.ok(scripts.indexOf('checkout-client.js')<scripts.indexOf('checkout.js'));
assert.ok(scripts.indexOf('checkout.js')>scripts.indexOf('compact-cards.js'));
for(const file of scripts){const result=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,file+': '+result.stderr)}
const sql=fs.readFileSync('backend/orders/migrations/001-orders.sql','utf8').replace(/^--.*$/gm,'');
assert.ok(!/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im.test(sql),'Migration must only create reviewed tables');
assert.equal((sql.match(/CREATE TABLE/g)||[]).length,4);
assert.equal((sql.match(/ENGINE=InnoDB/g)||[]).length,4);
assert.ok(sql.includes('uq_zt_order_idempotency'));assert.ok(sql.includes('ON DELETE RESTRICT'));
assert.ok(!fs.readFileSync('details.js','utf8').includes('Ваша заявка отправлена'));
const branch=cp.spawnSync('git',['branch','--show-current'],{encoding:'utf8'}).stdout.trim();
assert.equal(branch,'stage1/orders-mysql');
const refs=cp.spawnSync('git',['rev-parse','HEAD','main','origin/main'],{encoding:'utf8'});
assert.equal(refs.status,0);assert.equal(new Set(refs.stdout.trim().split(/\s+/)).size,1,'No commit, main/origin refs unchanged');
const php=cp.spawnSync('php',['-v'],{encoding:'utf8'});
let phpLint='unavailable';
if(!php.error&&php.status===0){
 const phpFiles=['api/v1/orders.php','backend/orders/config.example.php',...fs.readdirSync('backend/orders/lib').filter(x=>x.endsWith('.php')).map(x=>'backend/orders/lib/'+x),'tests/orders-validation.php','tests/orders-mysql.php'];
 for(const file of phpFiles){const result=cp.spawnSync('php',['-l',file],{encoding:'utf8'});assert.equal(result.status,0,file+': '+result.stdout+result.stderr)}
 const unit=cp.spawnSync('php',['tests/orders-validation.php'],{encoding:'utf8'});assert.equal(unit.status,0,unit.stdout+unit.stderr);console.log(unit.stdout.trim());phpLint='passed';
}
console.log(JSON.stringify({protectedFiles:Object.keys(baseline).length,products:53,imageReferences:89,scriptsChecked:scripts.length,branch,mainUnchanged:true,phpLint,mysqlTest:'not run'},null,2));
