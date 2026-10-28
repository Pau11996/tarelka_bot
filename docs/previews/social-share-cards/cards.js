const logo = `<svg viewBox="2 8 48 48" aria-hidden="true"><path d="M35.96 21.84A16.5 16.5 0 1 0 38.96 35.99" stroke="currentColor" stroke-width="3.3" stroke-linecap="round" fill="none"/><path d="M32.2 27.5A10.2 10.2 0 1 0 32.2 36.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M34 33.5C43.8 33 46.6 26.4 46 19C39.6 20.5 33.1 25 34 33.5Z" fill="currentColor"/></svg>`;
const brand = (extra = '') => `<span class="brand ${extra}">${logo}<b>тарелка</b></span>`;
const foot = (left = 'Мой дневник питания') => `<footer><span>${left}</span><span>tarelkaa.by</span></footer>`;
const macro = (p = '100', f = '50', c = '200', extra = '') => `<div class="macros ${extra}">${[['Белки',p,'p'],['Жиры',f,'f'],['Углеводы',c,'c']].map(([label,value,id]) => `<div class="macro ${id}"><span>${label}</span><strong>${value}<small> г</small></strong></div>`).join('')}</div>`;
const photo = (src, extra = '') => `<img class="${extra}" src="assets/${src}" alt="" />`;
const nutrientIcons = {
  energy: `<path class="icon-body" d="M18 2.8c1.7 6.1 8.6 9.3 8.6 16.5A10.6 10.6 0 0 1 5.4 19c0-4.4 2.5-8.2 6.5-12.1-.5 4.5 1.4 6.5 2.6 7.4C18.3 11.2 18.5 6.5 18 2.8Z"/><path class="icon-detail" d="M16.8 17c.4 3.6 4.1 4.8 4.1 7.5a4.9 4.9 0 0 1-9.8 0c0-2.8 3-5.5 5.7-7.5Z"/>`,
  protein: `<path class="icon-body" d="M16 3.3c-5.5 0-11 10.1-11 16.4a11 11 0 0 0 22 0C27 13.4 21.5 3.3 16 3.3Z"/><circle class="icon-detail" cx="16" cy="20.4" r="5.2"/><path class="icon-shine" d="M9 14.5c.4-1.3 1-2.5 1.6-3.4"/>`,
  fat: `<path class="icon-body" d="M16 3c-4.4 0-4.9 5.5-7.4 9.5C6 16.5 4.5 18.3 4.5 22A11.5 11.5 0 0 0 27.5 22c0-3.7-1.5-5.5-4.1-9.5C20.9 8.5 20.4 3 16 3Z"/><path class="icon-inset" d="M16 6.4c-2.2 0-3.2 5.1-5.3 8.2-1.8 2.9-3.1 4.8-3.1 7.3a8.4 8.4 0 0 0 16.8 0c0-2.5-1.3-4.4-3.1-7.3C19.2 11.5 18.2 6.4 16 6.4Z"/><ellipse class="icon-detail" cx="16" cy="22" rx="4.4" ry="5.1"/>`,
  carbs: `<path class="icon-stem" d="M16 29V7m0 20-5-4m5-2 5-4m-5-2-5-4"/><path class="icon-body" d="M16 9c-4.1-1.8-4.2-5.4 0-8 4.2 2.6 4.1 6.2 0 8ZM15.8 17c-6.7.2-9.5-2.6-9-8 5.4-.4 8.9 2.3 9 8ZM16.2 21c6.7.2 9.5-2.6 9-8-5.4-.4-8.9 2.3-9 8ZM15.8 26c-6.7.2-9.5-2.6-9-8 5.4-.4 8.9 2.3 9 8Z"/>`
};
const nutrientIcon = kind => `<i class="nutrient-icon" aria-hidden="true"><svg viewBox="0 0 32 34" fill="none" stroke-linecap="round" stroke-linejoin="round">${nutrientIcons[kind]}</svg></i>`;
const targetArt = `<svg class="target-art" viewBox="0 0 40 40" aria-hidden="true"><circle cx="18" cy="22" r="14" fill="#e6ecd6" stroke="#618747" stroke-width="1.5"/><circle cx="18" cy="22" r="8" fill="none" stroke="#618747" stroke-width="1.5"/><circle cx="18" cy="22" r="2.5" fill="#618747"/><path d="M18 22 32 8m-6 0 7-2-1 7" fill="none" stroke="#cf7048" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const plateArt = `<svg class="plate-art" viewBox="0 0 100 82" aria-hidden="true"><ellipse cx="49" cy="68" rx="35" ry="5" fill="#d9c9af" opacity=".45"/><path d="M20 37C14 22 20 12 31 14c0-13 16-13 20-1 10-8 20-2 17 10 15-2 18 13 7 19Z" fill="#69925c" stroke="#345c3d" stroke-width="1.5"/><path d="M30 16 38 43m14-26-9 27m23-16-15 18" stroke="#a6bf7a" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M68 22c-6-1-18 8-19 15s5 12 11 12 18-8 19-14-5-12-11-13Z" fill="#fff9df" stroke="#ac916b" stroke-width="1.3"/><circle cx="65" cy="35" r="6.5" fill="#eea446"/><circle cx="29" cy="35" r="8" fill="#dc7858" stroke="#a34e3a" stroke-width="1.4"/><path d="m25 29 5 3 3-4" stroke="#547744" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M13 42h72c-2 18-15 29-36 29S15 60 13 42Z" fill="#e7ad76" stroke="#885d3f" stroke-width="1.7"/><path d="M15 45h68" stroke="#fff3d6" stroke-width="2"/><path d="M29 52c2 6 7 10 12 11" stroke="#f7d7ad" stroke-width="3" stroke-linecap="round" fill="none"/><path d="m87 17 1 4 4 1-4 1-1 4-1-4-4-1 4-1Z" fill="#ca8056"/><path d="m10 24 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="#79905b"/></svg>`;
const dailyMetrics = () => `<div class="daily-metrics">${[['Калории','2 100','ккал','energy'],['Белки','120','г','protein'],['Жиры','60','г','fat'],['Углеводы','270','г','carbs']].map(([label,value,unit,kind])=>`<div class="daily-metric ${kind}">${nutrientIcon(kind)}<span>${label}</span><strong>${value}<small> ${unit}</small></strong></div>`).join('')}</div>`;
window.cards = [
  { id:'day-01', code:'Д1', type:'day', name:'Живые значки', desc:'Цветные иллюстрации КБЖУ и чистая композиция. Спокойно, но уже с характером.', cls:'strip s1', width:540, height:108, html:`
    <div class="strip-heading"><span>Моя дневная норма</span>${brand()}</div>
    ${dailyMetrics()}<div class="strip-note">Сегодня съедено 1 650 ккал <span>28 октября</span></div>` },
  { id:'day-02', code:'Д2', type:'day', name:'Энергия дня', desc:'Тёмный зелёный, яркий лайм и крупные значки. Самый контрастный вариант.', cls:'strip s2', width:540, height:108, html:`
    <div class="strip-identity"><h1>Моя норма<br>на день</h1>${brand()}</div>
    ${dailyMetrics()}<div class="strip-note">Сегодня съедено 1 650 ккал · 28 октября</div>` },
  { id:'day-03', code:'Д3', type:'day', name:'КБЖУ в стикерах', desc:'Объёмные наклейки, чуть повёрнутые карточки и сочные цвета. Самый игривый.', cls:'strip s3', width:540, height:108, html:`
    <div class="strip-heading"><span>Моя дневная норма</span>${brand()}</div>${dailyMetrics()}` },
  { id:'day-04', code:'Д4', type:'day', name:'Мой ориентир', desc:'Значок цели и цветные символы КБЖУ. Съеденное остаётся тонкой второй строкой.', cls:'strip s4', width:540, height:108, html:`
    <div class="table-identity">${brand()}${targetArt}<h1>Норма<br>на день</h1><span>Съедено · 28.10</span></div>
    ${dailyMetrics()}<div class="consumed-metrics"><span>1 650 ккал</span><span>100 г</span><span>50 г</span><span>200 г</span></div>` },
  { id:'day-05', code:'Д5', type:'day', name:'День со вкусом', desc:'Небольшая иллюстрация тарелки, тёплая палитра и дневная норма. Самый уютный.', cls:'strip s5', width:540, height:108, html:`
    <div class="food-identity">${plateArt}<span>День со вкусом.</span></div><div class="food-norm-label">Моя дневная норма</div>${dailyMetrics()}<div class="strip-signature"><span>Мой план на день</span>${brand()}</div>` },
  { id:'day-06', code:'Д6', type:'day', name:'Это на весь день?!', desc:'Кот только что узнал свою норму. Мемная реакция, крупные КБЖУ и короткая полоска.', cls:'strip s6', width:540, height:108, html:`
    <div class="meme-scene"><span class="meme-question">?!</span>${photo('meme-cat.png','meme-cat')}<div class="meme-bubble">ЭТО НА<br>ВЕСЬ ДЕНЬ?!</div></div>
    <div class="meme-norm-label">Моя дневная норма</div>${dailyMetrics()}<div class="meme-footer"><span>Согласовано с котом. Почти.</span>${brand()}</div>` },
  { id:'meal-01', code:'Б1', type:'meal', name:'Фото на первом месте', desc:'Большой снимок блюда, название и КБЖУ конкретной порции.', cls:'m1', html:`
    ${photo('pasta.jpg','m1-photo')}<div class="m1-logo">${brand()}</div><span class="meal-sticker">МОЙ ОБЕД</span>
    <div class="m1-panel"><div class="m1-title"><div><h1>Паста<br>с креветками</h1><span class="caption">Моя порция · 320 г</span></div><div class="food-energy"><strong>520</strong><span>ккал</span></div></div>${macro('32','16','62')}<div class="meal-footer"><span>КБЖУ моей порции</span><span>tarelkaa.by</span></div></div>` },
  { id:'meal-02', code:'Б2', type:'meal', name:'Как в журнале', desc:'Фото и типографика в двух колонках. Хорошо для простого блюда.', cls:'m2', html:`
    ${photo('yogurt-bowl.jpg','m2-photo')}<div class="m2-side">${brand()}<span class="eyebrow">МОЙ ЗАВТРАК</span><h1>Йогурт,<br>ягоды,<br><em>гранола.</em></h1><span class="caption">Моя порция · 280 г</span><div class="food-energy"><strong>365</strong><span>ккал на порцию</span></div>${macro('18','13','44')}<span class="m2-url">tarelkaa.by</span></div>` },
  { id:'meal-03', code:'Б3', type:'meal', name:'Фото-открытка', desc:'Немного личного настроения: фотография блюда и аккуратные цифры.', cls:'m3', html:`
    <header>${brand()}<span class="date">Мой завтрак</span></header><h1>Оладьи с вишней</h1>
    <div class="polaroid">${photo('pancakes.jpg')}<span>Моя порция · 250 г</span></div>
    <div class="round-calories"><strong>410</strong><span>ккал</span></div>
    ${macro('12','14','59')}${foot('КБЖУ моей порции')}` },
  { id:'meal-04', code:'Б4', type:'meal', name:'Находка на полке', desc:'Упаковка товара, точное название и показатели на всю баночку.', cls:'m4', html:`
    <header>${brand()}<span class="eyebrow">МОЯ НАХОДКА</span></header><h1>Беру с собой.</h1>
    ${photo('yogurt-product.png','m4-product')}<div class="m4-info"><h2>Греческий<br>йогурт, 2%</h2><p>Без добавок<br>Баночка · 170 г</p><div class="food-energy"><strong>124</strong><span>ккал на баночку</span></div></div>
    ${macro('17','3,4','6,3')}${foot('КБЖУ на 170 г')}` },
  { id:'meal-05', code:'Б5', type:'meal', name:'Продукт крупным планом', desc:'Более смелая карточка товара: крупная упаковка и заметные КБЖУ.', cls:'m5', html:`
    <header>${brand()}<span class="date">В моей корзине</span></header><h1>Йогурт<br>без добавок.</h1>
    <div class="m5-energy"><strong>124</strong><span>ккал</span><small>на баночку 170 г</small></div>${photo('yogurt-product.png','m5-product')}<span class="protein-sticker">17 г<br><b>белка</b></span>
    ${macro('17','3,4','6,3')}${foot('Греческий йогурт · 2%')}` },
];
window.cardMarkup = card => `<div class="art ${card.cls}" style="width:${card.width||540}px;height:${card.height||540}px" aria-label="${card.code}: ${card.name}">${card.html}</div>`;
