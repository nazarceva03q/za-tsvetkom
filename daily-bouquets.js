// Up to three current bouquets. Same schema as FLOWER_PRODUCTS, with unique
// id/slug and badge: 'Букет дня'. Publish only confirmed photos and prices.
// A future authenticated publishing service can update this file atomically.
window.DAILY_BOUQUETS = [{
  id:'product-daily',slug:'daily',name:'Название',description:'Описание',
  price:999,category:'Букет дня',note:'',stock:null,tags:'букет дня',
  badge:'Букет дня',images:[],placeholder:true
}];
