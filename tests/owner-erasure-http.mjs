import fs from 'node:fs';
import path from 'node:path';
export async function ownerErasureHttp({api,base,request,sql,config,write,sessionCookie,assert,root}) {
 const original=structuredClone(config);
 let r=await api(base,'d'.repeat(64));assert(r.httpStatusCode===201,'cleanup UI fixture created with synthetic data');
 const number=r.data.orderNumber,id=(await sql('SELECT id FROM zt_orders WHERE order_number=?',[number]))[0].id;
 const query='?view=cleanup&number='+number;
 r=await request({cookie:sessionCookie,query:'?id='+id});const csrf=r.text.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 r=await request({method:'POST',cookie:sessionCookie,body:new URLSearchParams({action:'retention_review',csrf,order_id:id,order_version:'0',review_version:'0',decision:'ready',goal_ended_on:today,confirm_clear:'1'}).toString()});
 assert(r.httpStatusCode===303,'cleanup fixture explicitly marked ready');
 config.erasure={schema_ready:true,copies_schema_ready:true,enabled:true,panel_enabled:false,copy_confirmation_enabled:true,
  backup_rollover_approved:true,backup_retention_days:30,evidence_directory:'/private/erasure-evidence',
  operator:{name:'Тестовый оператор',address:'Синтетический адрес'},actor:{name:'Тестовый оператор',role:'Оператор'},system:'Изолированная проверка',processors:[]};
 config.restore_guard={prepared:true};write();
 r=await request({cookie:sessionCookie,query});assert(r.httpStatusCode===403,'cleanup UI disabled by independent feature flag');
 config.erasure.panel_enabled=true;write();
 r=await request({query});assert(r.httpStatusCode===401&&!r.text.includes(number),'cleanup UI anonymous access denied');
 r=await request({cookie:sessionCookie,query});assert(r.httpStatusCode===200&&r.text.includes('Удаление пока недоступно.'),'single-request cleanup confirmation rendered');
 fs.writeFileSync(path.join(root,'docs/simplified/evidence/panel-cleanup.html'),r.text);
 const data={action:'erase_request',csrf,order_number:number,review_version:'1',exports:'1',vk:'1',logs:'1',
  backup_state:'rolling',backup_confirm:'1',backup_restriction:'1',restore_procedure:'1',copy_reference:'Synthetic copies, no actual personal data',confirm_number:number,confirm_delete:'1'};
 const post=(extra={},options={})=>request({method:'POST',cookie:sessionCookie,query,body:new URLSearchParams({...data,...extra}).toString(),...options});
 r=await post({csrf:'wrong'});assert(r.httpStatusCode===403,'cleanup bad CSRF denied');
 r=await post({}, {originValue:'https://evil.test'});assert(r.httpStatusCode===403,'cleanup foreign origin denied');
 r=await post({confirm_number:'ZT-FFFFFFFFFFFFFFFF'});assert(r.httpStatusCode===409,'cleanup wrong typed number denied');
 r=await post({logs:''});assert(r.httpStatusCode===409,'cleanup missing copy check denied');
 config.erasure.backup_rollover_approved=false;write();r=await post();assert(r.httpStatusCode===409,'browser cannot approve backup rollover');
 config.erasure.backup_rollover_approved=true;write();
 r=await post({review_version:'999'});assert(r.httpStatusCode===409,'cleanup stale review denied');
 assert((await sql('SELECT id FROM zt_orders WHERE id=?',[id])).length===1,'rejected cleanup leaves request intact');
 r=await post();assert(r.httpStatusCode===303,'authorized cleanup deletes one reviewed request');
 const location=r.headers.location[0],record=location.match(/record=([a-f0-9]{32})/)[1];
 assert((await sql('SELECT id FROM zt_orders WHERE id=?',[id])).length===0,'cleanup UI removes request from database');
 r=await request({cookie:sessionCookie,query:'?view=cleanup&record='+record});
 assert(r.text.includes('Заявка удалена из панели.')&&!r.text.includes('download='),'cleanup receipt distinguishes database removal from remaining backups');
 fs.writeFileSync(path.join(root,'docs/simplified/evidence/panel-cleanup-receipt.html'),r.text);
 for(const kind of ['act','journal','ledger']){
  r=await request({query:'?view=cleanup&download='+kind+'&record='+record});assert(r.httpStatusCode===401,'anonymous '+kind+' download denied');
  r=await request({cookie:sessionCookie,query:'?view=cleanup&download='+kind+'&record='+record});
  assert(r.httpStatusCode===404&&!JSON.stringify(r.headers).includes('attachment'),'owner panel has no '+kind+' download');
  assert(!r.text.includes(base.phone)&&!r.text.includes(base.address),'download '+kind+' excludes original customer contacts');
 }
 r=await post();assert(r.httpStatusCode===303,'repeated identical cleanup does not delete another request');
 const confirm={action:'confirm_erasure_copies',csrf,record_id:record,confirm_copies:'1',exports:'1',vk:'1',logs:'1',backup_confirm:'1',destroyed_on:today,copy_reference:'Synthetic completion only'};
 r=await request({method:'POST',cookie:sessionCookie,body:new URLSearchParams({...confirm,destroyed_on:'2099-01-01'}).toString()});
 assert(r.httpStatusCode===409,'copy completion rejects future date');
 r=await request({method:'POST',cookie:sessionCookie,body:new URLSearchParams(confirm).toString()});assert(r.httpStatusCode===303,'copy completion saved separately from database removal');
 r=await request({cookie:sessionCookie,query:'?view=cleanup&record='+record});assert(r.text.includes('Заявка удалена из панели.')&&!r.text.includes('download='),'confirmed copy review still requires signature');
 // A database-only cleanup must never attest unknown provider copies or logs.
 r=await api(base,'061026'.repeat(10)+'1234');assert(r.httpStatusCode===201,'pending review fixture created');
 const pendingNumber=r.data.orderNumber,pendingId=(await sql('SELECT id FROM zt_orders WHERE order_number=?',[pendingNumber]))[0].id;
 r=await request({method:'POST',cookie:sessionCookie,body:new URLSearchParams({action:'retention_review',csrf,order_id:pendingId,order_version:'0',review_version:'0',decision:'ready',goal_ended_on:today,confirm_clear:'1'}).toString()});
 assert(r.httpStatusCode===303,'pending copy fixture marked ready');
 config.erasure.pending_copy_review_enabled=true;config.erasure.backup_rollover_approved=false;config.restore_guard.prepared=false;write();
 r=await request({cookie:sessionCookie,query:'?view=cleanup&number='+pendingNumber});
 assert(r.text.includes('Подтверждение удаления')&&!r.text.includes('Технические сведения'),'pending review UI does not require false attestation');
 fs.writeFileSync(path.join(root,'docs/simplified/evidence/panel-cleanup-simple.html'),r.text);
 assert(!r.text.includes('name="confirm_number"')&&!r.text.includes('name="copy_reference"')&&!r.text.includes('name="pending_copies_confirm"'),'simple cleanup has no technical typing or second checkbox');
 const pending={action:'erase_request',csrf,order_number:pendingNumber,review_version:'1',backup_state:'pending',confirm_delete:'1'};
 const pendingPost=extra=>request({method:'POST',cookie:sessionCookie,body:new URLSearchParams({...pending,...extra}).toString()});
 r=await pendingPost({confirm_delete:''});assert(r.httpStatusCode===409,'pending review requires acknowledgement');
 config.erasure.pending_copy_review_enabled=false;write();
 r=await pendingPost();assert(r.httpStatusCode===409,'pending review cannot be enabled by browser');
 config.erasure.pending_copy_review_enabled=true;write();
 r=await pendingPost({review_version:'999'});assert(r.httpStatusCode===409,'simple cleanup stale review rejected');
 r=await pendingPost();assert(r.httpStatusCode===303,'database-only cleanup allowed with external review open');
 const pendingRecord=r.headers.location[0].match(/record=([a-f0-9]{32})/)[1];
 const row=(await sql('SELECT copy_state,copies_confirmed_at,evidence FROM zt_erasure_records WHERE id=?',[pendingRecord]))[0];
 const evidence=JSON.parse(row.evidence);
 assert(row.copy_state==='pending'&&row.copies_confirmed_at===null,'unknown copies remain pending in SQL');
 assert(evidence.copies.logs===false&&evidence.copies.exports===false&&evidence.copies.vk===false&&evidence.copies.backupRestrictionConfirmed===false,'no fabricated copy checks');
 assert(evidence.copies.reference.includes('не завершена'),'pending technical note generated on server');
 assert((await sql('SELECT id FROM zt_orders WHERE id=?',[pendingId])).length===0,'database-only cleanup actually removes fixture');
 r=await request({cookie:sessionCookie,query:'?view=cleanup&record='+pendingRecord});
 assert(r.text.includes('Заявка удалена из панели.')&&!r.text.includes('download='),'database-only receipt clearly states limitation');
 r=await request({cookie:sessionCookie,query:'?view=cleanup&download=act&record='+pendingRecord});
 assert(!r.text.includes('ограничение доступа подтверждено человеком')&&!r.text.includes('Обработчики по поручению: отсутствуют'),'draft does not fabricate archive restrictions or absence of processors');
 Object.keys(config).forEach(k=>delete config[k]);Object.assign(config,original);write();
}
