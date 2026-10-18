const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const root=process.cwd(),before=JSON.parse(fs.readFileSync('docs/simplified/before-hashes.json'));
const intended=['app.js','details.js','index.html','checkout.js','backend/orders/lib/Validation.php','backend/orders/lib/Http.php','backend/orders/lib/Repository.php','backend/orders/lib/Notifications.php','backend/orders/lib/Owner.php','backend/orders/config.example.php','backend/orders/bin/notify.php','owner/orders.php','bot/index.js','bot/src/config.js','bot/src/bot.js','bot/src/vkWebhook.js','bot/src/admin.js','bot/scripts/build-yandex-zip.cjs'];
const changes=[],unchanged=[];
for(const [p,h]of Object.entries(before)){const now=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(now!==h){if(!intended.includes(p))throw Error('Unexpected overwrite '+p);changes.push(p)}else unchanged.push(p);}
const previous=JSON.parse(fs.readFileSync('docs/stage1/review-input-hashes.json'));
for(const p of ['refinement.js','catalog-sync.js','package.json','tests/admin-flow.cjs','tests/vk-bot.cjs','legal.html'])if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==previous[p])throw Error('Prior work overwritten '+p);
const jsFiles=['app.js','details.js','checkout.js','checkout-client.js','bot/index.js','bot/src/siteRelay.js','bot/src/config.js','bot/src/bot.js','bot/src/admin.js','bot/src/vkWebhook.js','bot/scripts/build-yandex-zip.cjs','tests/orders-browser.cjs','tests/site-relay.cjs','tests/vk-bot-simplified.cjs'];
for(const p of jsFiles){const r=cp.spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(r.status!==0)throw Error(p+r.stderr);}
fs.mkdirSync('docs/simplified/evidence',{recursive:true});fs.writeFileSync('docs/simplified/evidence/preservation.json',JSON.stringify({unchanged,intentionallyChanged:changes,priorWorkPreserved:true,jsSyntax:jsFiles.length},null,2));
console.log('Preserved '+unchanged.length+' baseline files; '+changes.length+' authorized updates; '+jsFiles.length+' JS syntax checks');
