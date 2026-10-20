'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const products=require('../src/products');
function buildSeed(root){
 const window={};
 for(const file of ['products-data.js','daily-bouquets.js','balloons-data.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{window},{filename:file,timeout:1000});
 const catalog=Object.fromEntries(products.CATEGORY_NAMES.map(n=>[n,[]]));
 const seen=new Set();
 for(const p of [...window.FLOWER_PRODUCTS,...window.DAILY_BOUQUETS.filter(p=>!p.placeholder),...window.BALLOON_BOUQUETS,...window.BUSINESS_BALLOONS]){
  if(!catalog[p.category]||seen.has(p.id))throw Error('Unexpected category or duplicate product');
  seen.add(p.id);catalog[p.category].push({...p,isHit:Boolean(p.isHit)});
 }
 if(seen.size!==53||Object.values(catalog).flat().reduce((n,p)=>n+p.images.length,0)!==89)throw Error('Review baseline counts before preparing seed');
 return catalog;
}
module.exports={buildSeed};
