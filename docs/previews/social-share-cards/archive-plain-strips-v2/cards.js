const logo = `<svg viewBox="2 8 48 48" aria-hidden="true"><path d="M35.96 21.84A16.5 16.5 0 1 0 38.96 35.99" stroke="currentColor" stroke-width="3.3" stroke-linecap="round" fill="none"/><path d="M32.2 27.5A10.2 10.2 0 1 0 32.2 36.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M34 33.5C43.8 33 46.6 26.4 46 19C39.6 20.5 33.1 25 34 33.5Z" fill="currentColor"/></svg>`;
const brand = (extra = '') => `<span class="brand ${extra}">${logo}<b>тарелка</b></span>`;
const foot = (left = 'Мой дневник питания') => `<footer><span>${left}</span><span>tarelkaa.by</span></footer>`;
const macro = (p = '100', f = '50', c = '200', extra = '') => `<div class="macros ${extra}">${[['Белки',p,'p'],['Жиры',f,'f'],['Углеводы',c,'c']].map(([label,value,id]) => `<div class="macro ${id}"><span>${label}</span><strong>${value}<small> г</small></strong></div>`).join('')}</div>`;
const photo = (src, extra = '') => `<img class="${extra}" src="assets/${src}" alt="" />`;
const dailyMetrics = () => `<div class="daily-metrics">${[['Калории','2 100','ккал','energy'],['Белки','120','г','protein'],['Жиры','60','г','fat'],['Углеводы','270','г','carbs']].map(([label,value,unit,kind])=>`<div class="daily-metric ${kind}"><span>${label}</span><strong>${value}<small> ${unit}</small></strong></div>`).join('')}</div>`;
window.cards = [
  { id:'day-01', code:'Д1', type:'day', name:'Тихая норма', desc:'Четыре цели в одну строку. Съеденное — небольшой подписью внизу.', cls:'strip s1', width:540, height:108, html:`
    <div class="strip-heading"><span>Моя дневная норма</span>${brand()}</div>
    ${dailyMetrics()}<div class="strip-note">Сегодня съедено 1 650 ккал <span>28 октября</span></div>` },
  { id:'day-02', code:'Д2', type:'day', name:'Зелёная полоса', desc:'Контрастный вариант с заголовком слева. Норма читается первым взглядом.', cls:'strip s2', width:540, height:108, html:`
    <div class="strip-identity"><h1>Моя норма<br>на день</h1>${brand()}</div>
    ${dailyMetrics()}<div class="strip-note">Сегодня съедено 1 650 ккал · 28 октября</div>` },
  { id:'day-03', code:'Д3', type:'day', name:'Четыре капсулы', desc:'Каждому показателю — свой мягкий цвет. Только дневные цели.', cls:'strip s3', width:540, height:108, html:`
    <div class="strip-heading"><span>Моя дневная норма</span>${brand()}</div>${dailyMetrics()}` },
  { id:'day-04', code:'Д4', type:'day', name:'Норма и факт', desc:'Норма крупно, съеденное — второй строкой. Для сравнения всех четырёх значений.', cls:'strip s4', width:540, height:108, html:`
    <div class="table-identity">${brand()}<h1>Норма<br>на день</h1><span>Съедено · 28.10</span></div>
    ${dailyMetrics()}<div class="consumed-metrics"><span>1 650 ккал</span><span>100 г</span><span>50 г</span><span>200 г</span></div>` },
  { id:'day-05', code:'Д5', type:'day', name:'Мой план', desc:'Тёплая типографическая полоска без текущего прогресса. Можно делиться в любой момент.', cls:'strip s5', width:540, height:108, html:`
    <div class="strip-identity"><h1>Мой план<br>на день.</h1></div>${dailyMetrics()}<div class="strip-signature">Моя дневная норма ${brand()}</div>` },
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
