// Prepares a local REG.RU seed only. The private PHP CLI initializes the server.
// Never overwrites existing bot changes. No photos are reuploaded.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {buildSeed}=require('./catalog-seed.cjs');
async function main(){
 const args=process.argv.slice(2);
 if(args.length)throw Error('Use no args: preparation only. Initialize REG with init-catalog.php.');
 const root=path.resolve(__dirname,'../..'),catalog=buildSeed(root);
 const file=path.join(__dirname,'../catalog.seed.json');
 fs.writeFileSync(file,JSON.stringify(catalog,null,2)+'\n');
 console.log('Prepared local catalog.seed.json: 53 products, 89 image references. No network used for preparation.');
}
if(require.main===module)main().catch(()=>{console.error('Catalog preparation/creation failed. Check configuration, existing catalog and source files; do not overwrite a live catalog.');process.exitCode=1});
module.exports={main};
