const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function env(){const config={siteBaseUrl:'https://shop.test',ownerOrdersUrl:'https://shop.test/owner/orders.php',adminChatIds:['99']},sent=[];
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../bot/src/requestPanel.js'),'utf8'),{module,URL,require:n=>n==='./config'?config:
  {sendMessage:async(target,text,rows)=>sent.push({target,text,rows}),callbackButton:(text,payload)=>({text,payload}),linkButton:(text,link)=>({text,link})}});
 return{panel:module.exports,config,sent};}
test('panel links contain only a validated request number, never an access token',()=>{
 const {panel,config}=env();assert.equal(panel.urlFor(config),'https://shop.test/owner/orders.php');
 assert.equal(panel.urlFor(config,'ZT-1234567890ABCDEF'),'https://shop.test/owner/orders.php?number=ZT-1234567890ABCDEF');
 for(const value of ['https://evil.test','ZT-123&token=x','','../private'])assert.throws(()=>panel.urlFor(config,value));
 for(const url of ['https://evil.test/owner/orders.php','http://shop.test/owner/orders.php','https://shop.test/owner/orders.php?token=x','https://u:p@shop.test/owner/orders.php'])assert.throws(()=>panel.urlFor({...config,ownerOrdersUrl:url}));
});
test('panel menu sends no customer data and refuses non-admin',async()=>{
 const {panel,sent}=env();await panel.send('1');assert.equal(sent.length,0);
 await panel.send('99');assert.equal(sent.length,1);assert.equal(sent[0].rows[0][0].link,'https://shop.test/owner/orders.php');
 assert.match(sent[0].text,/логином и паролем/);
});
