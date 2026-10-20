'use strict';
const prompt='Напишите, что показывать в строке цены: цену со знаком ₽, диапазон, «от … ₽» или любой другой текст. Например: 1000 ₽, 1000–2000 ₽, от 1000 ₽, Товар под заказ.';
function parse(text){
 const label=String(text).trim();
 if(!label)throw Error('Напишите текст для строки цены.');
 const match=label.match(/^((?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:\.|лей|ля)?|р\.?)?$/i);
 const n=match?Number(match[1].replace(/[ \u00a0\u202f]/g,'').replace(',','.')):null;
 return {price:n!==null&&Number.isFinite(n)&&n>0&&n<=10000000?n:null,priceLabel:label};
}
const format=(value,label)=>label||((Number.isFinite(value)&&value>0)?new Intl.NumberFormat('ru-RU').format(value)+' ₽':'Стоимость по согласованию');
function business(prices,labels=[]){
 if(prices.length&&prices.every(p=>Number.isFinite(p)&&p>0))return {price:Math.min(...prices),maxPrice:Math.max(...prices),priceLabel:labels.length===prices.length&&new Set(labels).size===1?labels[0]:''};
 const text=prices.map((p,i)=>format(p,labels[i]));
 return {price:null,maxPrice:null,priceLabel:new Set(text).size===1?text[0]:'Стоимость по согласованию'};
}
module.exports={prompt,parse,format,business};
