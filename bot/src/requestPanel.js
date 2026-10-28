'use strict';
const config=require('./config');
const vk=require('./vkApi');
function urlFor(cfg=config,number) {
  const url=new URL(cfg.ownerOrdersUrl),site=new URL(cfg.siteBaseUrl);
  if(url.protocol!=='https:'||url.origin!==site.origin||url.pathname!=='/owner/orders.php'
    ||url.username||url.password||url.search||url.hash)throw Error('INVALID_PANEL_URL');
  if(number!==undefined){if(!/^ZT-[A-F0-9]{16}$/.test(number))throw Error('INVALID_REQUEST_NUMBER');url.searchParams.set('number',number);}
  return url.href;
}
async function send(userId,number) {
  if(!(config.adminChatIds||[]).some(id=>String(id)===String(userId)))return;
  return vk.sendMessage({userId},'Заявки доступны в защищённой панели магазина. Войдите с логином и паролем панели, чтобы увидеть контакты, пожелания и фотографии.',
    [[vk.linkButton(number?'Открыть заявку':'Открыть заявки',urlFor(config,number))],[vk.callbackButton('⬅️ В меню','admin:menu')]]);
}
module.exports={urlFor,send};
