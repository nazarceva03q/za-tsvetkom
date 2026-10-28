import fs from 'node:fs';import path from 'node:path';
export async function retentionHttp({request,sql,config,write,sessionCookie,loginCookie,loginCsrf,id,assert,root}){
 const post=extra=>request({method:'POST',cookie:sessionCookie,body:new URLSearchParams({...data,...extra}).toString()});
 let r=await request({cookie:sessionCookie,query:'?view=retention'});
 assert(r.httpStatusCode===403,'review feature off blocks view');
 config.workflow.enabled=false;config.retention_review={enabled:true};write();
 r=await request({cookie:sessionCookie,query:'?id='+id});
 assert(r.httpStatusCode===200&&r.text.includes('Хранение заявки')&&!r.text.includes('name="next_action"'),'review works independently of workflow');
 const csrf=r.text.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const next=new Date(Date.parse(today+'T00:00:00Z')+10*86400000).toISOString().slice(0,10);
 const data={action:'retention_review',csrf,order_id:id,order_version:'1',review_version:'0',decision:'keep',reason:'active_order',review_date:next};
 r=await post({csrf:'bad'});assert(r.httpStatusCode===403,'review invalid CSRF denied');
 r=await request({method:'POST',cookie:sessionCookie+'; '+loginCookie,body:new URLSearchParams({...data,csrf:loginCsrf}).toString()});
 assert(r.httpStatusCode===403,'prelogin token cannot save retention decision');
 r=await request({method:'POST',cookie:sessionCookie,originValue:'https://evil.test',body:new URLSearchParams(data).toString()});assert(r.httpStatusCode===403,'review foreign origin denied');
 config.retention_review.enabled=false;write();r=await post({});assert(r.httpStatusCode===403,'disabled review blocks mutation');config.retention_review.enabled=true;write();
 r=await post({});assert(r.httpStatusCode===303,'authorized review saved with redirect');
 r=await post({});assert(r.httpStatusCode===409&&r.text.includes('другом окне'),'stale review has useful conflict error');
 r=await post({review_version:'1',decision:'ready',goal_ended_on:today});assert(r.httpStatusCode===409&&r.text.includes('Подтвердите'),'ready requires explicit confirmation');
 r=await post({review_version:'1',decision:'ready',goal_ended_on:today,confirm_clear:'1'});assert(r.httpStatusCode===303,'ready mark saved');
 assert((await sql('SELECT phone,erased_at FROM zt_orders WHERE id=?',[id]))[0].phone==='79990000011'&&(await sql('SELECT erased_at FROM zt_orders WHERE id=?',[id]))[0].erased_at===null,'HTTP decisions retain request data');
 r=await request({cookie:sessionCookie,query:'?view=retention'});assert(r.httpStatusCode===200&&r.text.includes('?id='+id),'ready request listed for review');
 fs.writeFileSync(path.join(root,'docs/simplified/evidence/panel-retention.html'),r.text);
 r=await request({cookie:sessionCookie,query:'?id='+id});assert(r.text.includes('Можно очистить')&&r.text.includes('Данные сейчас не удалятся'),'detail explains mark without deletion');
 fs.writeFileSync(path.join(root,'docs/simplified/evidence/panel-retention-detail.html'),r.text);
 r=await request({query:'?view=retention'});assert(r.httpStatusCode===401&&!r.text.includes('Тест панели'),'anonymous review denied');
 r=await request({cookie:sessionCookie,query:'?view=retention&page=-1'});assert(r.httpStatusCode===422,'invalid review page rejected');
}
