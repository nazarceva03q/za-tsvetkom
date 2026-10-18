'use strict';
// Read-only check for the legacy snapshot. Requests v2 do not load this catalogue.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
if(process.argv.includes('--write'))throw Error('Legacy snapshot writes are retired. Do not overwrite requests-v2 consent with legal.html.');
const root=path.resolve(__dirname,'..'),files=['products-data.js','balloons-data.js','daily-bouquets.js'];
const context={window:{}};
for(const name of files)vm.runInNewContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name,timeout:1000});
const products=[...context.window.FLOWER_PRODUCTS,...context.window.BALLOON_BOUQUETS,...context.window.BUSINESS_BALLOONS];
if(products.length!==53||products.reduce((s,p)=>s+p.images.length,0)!==89||new Set(products.map(p=>p.id)).size!==53)throw Error('Unexpected catalog counts or duplicate IDs; review manually');
for(const p of products){
 if(!/^[a-z0-9-]{1,100}$/.test(p.id)||!Number.isFinite(p.price)||p.price<=0||!Number.isInteger(p.price*100))throw Error('Invalid product '+p.id);
 for(const image of p.images)if(!fs.existsSync(path.join(root,image.split('?')[0])))throw Error('Missing image '+image);
}
const target=path.join(root,'backend/orders/catalog.json');
const snapshot=JSON.parse(fs.readFileSync(target,'utf8'));
const expected=JSON.parse(JSON.stringify(products.map(p=>({...p,priceKopecks:Math.round(p.price*100)}))));
assert.deepEqual(snapshot.products,expected,'Legacy product snapshot differs; review product changes separately');
console.log('Catalog verified: 53 products, 89 image references; legacy consent metadata retained, requests-v2 consent reviewed separately');
