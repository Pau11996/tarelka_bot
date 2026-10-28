const logo = `<svg viewBox="2 8 48 48" aria-hidden="true"><path d="M35.96 21.84A16.5 16.5 0 1 0 38.96 35.99" stroke="currentColor" stroke-width="3.3" stroke-linecap="round" fill="none"/><path d="M32.2 27.5A10.2 10.2 0 1 0 32.2 36.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/><path d="M34 33.5C43.8 33 46.6 26.4 46 19C39.6 20.5 33.1 25 34 33.5Z" fill="currentColor"/></svg>`;
const brand = (extra = '') => `<span class="brand ${extra}">${logo}<b>тарелка</b></span>`;
const foot = (left = 'Мой дневник питания') => `<footer><span>${left}</span><span>tarelkaa.by</span></footer>`;
const macro = (p = '100', f = '50', c = '200', extra = '') => `<div class="macros ${extra}">${[['Белки',p,'p'],['Жиры',f,'f'],['Углеводы',c,'c']].map(([label,value,id]) => `<div class="macro ${id}"><span>${label}</span><strong>${value}<small> г</small></strong></div>`).join('')}</div>`;
const photo = (src, extra = '') => `<img class="${extra}" src="assets/${src}" alt="" />`;
const ring = `<svg class="ring" viewBox="0 0 140 140"><circle cx="70" cy="70" r="60" fill="none" stroke="#e2eadb" stroke-width="11"/><circle cx="70" cy="70" r="60" fill="none" stroke="#2c8152" stroke-width="11" stroke-linecap="round" stroke-dasharray="296 377" transform="rotate(-90 70 70)"/></svg>`;
window.cards = [
  { id:'day-01', code:'Д1', type:'day', name:'Чистый баланс', desc:'Самый близкий к стилю приложения: крупные цифры и прогресс.', cls:'d1', html:`
    <header>${brand()}<span class="date-pill">28 октября</span></header>
    <div class="d1-heading"><span class="eyebrow">МОЙ ДНЕВНИК ПИТАНИЯ</span><h1>День в цифрах</h1></div>
    <div class="d1-main"><div><span class="caption">Съедено на сегодня</span><div class="calories">1 650</div><span class="goal">из 2 100 ккал</span></div><div class="ring-wrap">${ring}<div><strong>79<small>%</small></strong><span>от цели</span></div></div></div>
    <div class="d1-remaining"><span class="tiny-dot"></span>До дневной цели ещё <b>450 ккал</b></div>
    ${macro()}${foot()}` },
  { id:'day-02', code:'Д2', type:'day', name:'Зелёный постер', desc:'Контрастная карточка, которую легко прочитать прямо в ленте.', cls:'d2', html:`
    <header>${brand()}<span class="date">28 / 10</span></header>
    <h1>Мой день.<br><em>Мой ритм.</em></h1>
    <div class="d2-energy"><strong>1 650</strong><span>ккал</span></div>
    <div class="d2-goal"><span>Съедено из 2 100 ккал</span><b>79%</b></div>
    <div class="progress"><i></i></div><div class="d2-remaining">До цели осталось 450 ккал</div>
    ${macro()}${foot('Записано в Тарелке')}` },
  { id:'day-03', code:'Д3', type:'day', name:'Вкусный дневник', desc:'Итоги дня вместе с фотографиями еды — личная мини-история.', cls:'d3', html:`
    <header>${brand()}<span class="date">28 октября · среда</span></header>
    <div class="d3-title"><h1>Такой вот<br><em>вкусный день.</em></h1><span class="little-note">Мой день<br>в Тарелке ↙</span></div>
    <div class="photo-strip">${photo('yogurt-bowl.jpg')}${photo('pasta.jpg')}${photo('pancakes.jpg')}</div>
    <div class="d3-energy"><div><strong>1 650</strong><span> / 2 100 ккал</span><small>съедено на сегодня</small></div><div class="mini-pill">Осталось<br><b>450 ккал</b></div></div>
    ${macro()}${foot()}` },
  { id:'day-04', code:'Д4', type:'day', name:'Чек моего дня', desc:'Бумажный чек: спокойная, компактная и чуть необычная подача.', cls:'d4', html:`
    <div class="receipt">
      <header>${brand()}<span>28.10.26</span></header><div class="receipt-heading"><span class="eyebrow">ДНЕВНИК ПИТАНИЯ</span><h1>Итого за день</h1></div>
      <div class="receipt-main"><span>СЪЕДЕНО</span><strong>1 650<small> ккал</small></strong></div>
      <div class="receipt-goal"><span>Дневная цель</span><b>2 100 ккал</b></div>
      <div class="receipt-macros">${[['Белки','100 г'],['Жиры','50 г'],['Углеводы','200 г']].map(([label,value])=>`<div><span>${label}</span><i></i><b>${value}</b></div>`).join('')}</div>
      <div class="receipt-bottom"><span>До цели осталось <b>450 ккал</b></span><div class="stamp">79%<small>ОТ ЦЕЛИ</small></div></div>
      <div class="receipt-footer">Сохранено в Тарелке · tarelkaa.by</div>
    </div>` },
  { id:'day-05', code:'Д5', type:'day', name:'День в стикерах', desc:'Мягкие цвета и живые наклейки — для лёгкой личной публикации.', cls:'d5', html:`
    <header>${brand()}<span class="date-sticker">СР, 28 ОКТ</span></header>
    <h1>Сегодня<br>на моей тарелке<span>✳</span></h1>
    <div class="calorie-sticker"><span>СЪЕДЕНО ЗА ДЕНЬ</span><div><strong>1 650</strong><b>ккал</b></div><small>из 2 100 ккал · 79% от цели</small></div>
    <div class="remaining-sticker">До цели ещё 450 ккал ↗</div>
    ${macro()}${foot('Маленькая история моего дня')}` },
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
window.cardMarkup = card => `<div class="art ${card.cls}" aria-label="${card.code}: ${card.name}">${card.html}</div>`;
