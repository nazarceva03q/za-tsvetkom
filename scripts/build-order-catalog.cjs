'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),files=['products-data.js','balloons-data.js','daily-bouquets.js'];
const context={window:{}};
for(const name of files)vm.runInNewContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name,timeout:1000});
const products=[...context.window.FLOWER_PRODUCTS,...context.window.BALLOON_BOUQUETS,...context.window.BUSINESS_BALLOONS];
if(products.length!==53||products.reduce((s,p)=>s+p.images.length,0)!==89||new Set(products.map(p=>p.id)).size!==53)throw Error('Unexpected catalog counts or duplicate IDs; review manually');
for(const p of products){
 if(!/^[a-z0-9-]{1,100}$/.test(p.id)||!Number.isFinite(p.price)||p.price<=0||!Number.isInteger(p.price*100))throw Error('Invalid product '+p.id);
 for(const image of p.images)if(!fs.existsSync(path.join(root,image.split('?')[0])))throw Error('Missing image '+image);
}
const document={schema:1,sourceFiles:Object.fromEntries(files.map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex')])),
 consentVersion:'2026-10-orders-v1',consentTextSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'legal.html'))).digest('hex'),
 products:products.map(p=>({...p,priceKopecks:Math.round(p.price*100)}))};
const output=JSON.stringify(document,null,2)+'\n',target=path.join(root,'backend/orders/catalog.json');
if(process.argv.includes('--write')){
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output);
 fs.copyFileSync(path.join(root,'legal.html'),path.join(root,'backend/orders/consent.html'));
 console.log('Prepared private snapshot: 53 products, 89 image references; no MySQL import');
}else{
 if(fs.readFileSync(target,'utf8')!==output)throw Error('Private catalog differs from source; regenerate only after review');
 if(fs.readFileSync(path.join(root,'backend/orders/consent.html'),'utf8')!==fs.readFileSync(path.join(root,'legal.html'),'utf8'))throw Error('Consent snapshot differs');
 console.log('Snapshot verified: 53 products, 89 image references');
}
