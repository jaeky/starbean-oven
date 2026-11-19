const ingredients = {
  dough: [
    { id: 'gold', label: '동그란 노란 도우' },
    { id: 'cocoa', label: '네모난 갈색 도우' },
    { id: 'leaf', label: '꽃처럼 둥근 초록 도우' },
  ],
  sauce: [
    { id: 'tomato', label: '토마토 소스' },
    { id: 'cream', label: '크림 소스' },
    { id: 'pesto', label: '초록 소스' },
  ],
  toppings: [
    { id: 'pepperoni', label: '페퍼로니' },
    { id: 'mushroom', label: '양송이' },
    { id: 'pepper', label: '피망' },
    { id: 'pineapple', label: '파인애플' },
    { id: 'corn', label: '옥수수' },
  ],
};

const examples = [
  { dough: 'leaf', sauce: 'tomato', pieces: { 0: ['pepperoni'], 2: ['mushroom'], 4: ['pepperoni'], 6: ['mushroom'], 8: ['pepperoni'] } },
  { dough: 'cocoa', sauce: 'cream', pieces: { 0: ['corn'], 2: ['pepper'], 4: ['pineapple'], 6: ['pepper'], 8: ['pineapple'] } },
  { dough: 'gold', sauce: 'pesto', pieces: { 0: ['mushroom'], 1: ['corn'], 3: ['pineapple'], 5: ['corn'], 8: ['mushroom'] } },
];

const slots = [[31, 29], [50, 24], [69, 29], [23, 50], [50, 50], [77, 50], [30, 70], [50, 76], [70, 70]];
const cues = {
  dough: '도우를 골라 둥근 작업대로 가져가요.',
  sauce: '소스를 골라 도우에 끌어 놓아요.',
  toppings: '토핑을 도우 위로 움직여요. 피자를 화덕으로 가져가면 구워져요.',
  baking: '화덕에서 피자를 굽고 있어요.',
  serve: '구운 피자를 손님에게 가져다줘요.',
  done: '손님에게 피자를 건넸어요. 다시 만들 수 있어요.',
};
const bakeTime = 2100;
const byId = (id) => document.getElementById(id);
const kitchen = byId('kitchen');
const lobby = byId('lobby');
const supplies = byId('supplies');
const board = byId('board');
const oven = byId('oven');
const cooked = byId('cooked');
const guest = byId('guest');
const replay = byId('replay');
const ghost = byId('ghost');
const hand = byId('hand');
const guide = byId('guide');
const sound = byId('sound');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let stage = 'dough';
let pizza = { dough: null, sauce: null, pieces: {} };
let round = 0;
let selected = null;
let drag = null;
let skippedClick = null;
let ovenTimer;
let hintTimer;
let handMotion;
let highlighted;
let ghostMotion;
let audio;

function icon(group, id) {
  const span = document.createElement('span');
  if (group === 'dough') {
    span.className = 'dough';
    span.dataset.dough = id;
  } else {
    span.className = 'food';
    span.dataset.food = id;
  }
  return span;
}

function makeDish(data, cookedState = false, fresh = -1) {
  const dish = document.createElement('span');
  dish.className = 'dish';
  dish.dataset.dough = data.dough;
  if (cookedState) dish.dataset.cooked = '';
  if (data.sauce) {
    const sauce = document.createElement('span');
    sauce.className = 'sauce';
    sauce.dataset.sauce = data.sauce;
    dish.append(sauce);
  }
  for (const [slot, items] of Object.entries(data.pieces)) {
    const [x, y] = slots[slot];
    const radius = items.length > 1 ? 6.5 : 0;
    items.forEach((id, index) => {
      const angle = Math.PI * 2 * index / items.length + Number(slot) * .6;
      const piece = document.createElement('span');
      piece.className = Number(slot) === fresh && index === items.length - 1 ? 'piece fresh' : 'piece';
      piece.style.left = (x + radius * Math.cos(angle)) + '%';
      piece.style.top = (y + radius * Math.sin(angle)) + '%';
      piece.style.setProperty('--turn', ((Number(slot) * 39 + index * 18) % 75 - 37) + 'deg');
      piece.append(icon('toppings', id));
      dish.append(piece);
    });
  }
  return dish;
}

function renderPizza(fresh = -1) {
  const atOven = stage === 'baking' || stage === 'serve';
  board.replaceChildren();
  cooked.replaceChildren();
  if (!pizza.dough) return;
  (atOven ? cooked : board).append(makeDish(pizza, stage === 'serve' || stage === 'done', fresh));
}

function setStage(next) {
  stage = next;
  selected = null;
  kitchen.dataset.stage = stage;
  guide.textContent = cues[stage];
  supplies.hidden = !ingredients[stage];
  supplies.replaceChildren();
  supplies.dataset.set = stage === 'toppings' ? 'wide' : 'small';
  for (const ingredient of ingredients[stage] ?? []) {
    const button = document.createElement('button');
    button.className = 'supply';
    button.type = 'button';
    button.dataset.supply = ingredient.id;
    button.setAttribute('aria-label', ingredient.label);
    button.setAttribute('aria-pressed', 'false');
    button.append(icon(stage, ingredient.id));
    supplies.append(button);
  }
  board.disabled = ['baking', 'serve', 'done'].includes(stage);
  board.setAttribute('aria-label', stage === 'toppings' ? '피자에 토핑 놓기 또는 피자 집기' : '피자 작업대');
  oven.disabled = stage !== 'toppings' || !Object.keys(pizza.pieces).length;
  cooked.hidden = stage !== 'baking' && stage !== 'serve';
  cooked.disabled = stage !== 'serve';
  guest.disabled = stage !== 'serve';
  replay.hidden = stage !== 'done';
  byId('bake-progress').hidden = stage !== 'baking';
  byId('confetti').hidden = stage !== 'done';
  renderPizza();
  scheduleHint();
}

function stopHint() {
  clearTimeout(hintTimer);
  handMotion?.cancel();
  hand.hidden = true;
  highlighted?.classList.remove('hint-target');
  highlighted = null;
}

function middle(element, x = .5, y = .5) {
  const r = element.getBoundingClientRect();
  return { x: r.left + r.width * x, y: r.top + r.height * y };
}

function scheduleHint(forIngredient = false) {
  stopHint();
  if (kitchen.hidden || stage === 'baking' || stage === 'done') return;
  hintTimer = setTimeout(() => {
    let source;
    let target;
    if (stage === 'serve') {
      source = cooked;
      target = guest;
    } else if (stage === 'toppings' && !oven.disabled && !forIngredient) {
      source = board;
      target = oven;
    } else {
      const sample = examples[round];
      const idea = stage === 'toppings' ? Object.values(sample.pieces)[0][0] : sample[stage];
      source = [...supplies.children].find(button => button.dataset.supply === (selected ?? idea));
      target = board;
    }
    if (!source) return;
    highlighted = target;
    target.classList.add('hint-target');
    if (motion.matches) return;
    const from = middle(source);
    const to = middle(target, .5, target === guest ? .72 : .51);
    if (from.y > innerHeight + 15 || to.y > innerHeight + 15) return;
    const at = ({ x, y }) => `translate(${x + scrollX - 9}px, ${y + scrollY + 6}px)`;
    hand.hidden = false;
    const animation = hand.animate([
      { transform: at(from), opacity: 0 },
      { transform: at(from), opacity: 1, offset: .14 },
      { transform: at(to), opacity: 1, offset: .73 },
      { transform: at(to), opacity: 0 },
    ], { duration: 1700, iterations: 3, easing: 'ease-in-out' });
    handMotion = animation;
    animation.onfinish = () => {
      if (handMotion === animation) hand.hidden = true;
    };
  }, 1150);
}

function reset(nextOrder) {
  clearTimeout(ovenTimer);
  stopHint();
  drag = null;
  skippedClick = null;
  hideGhost();
  round = nextOrder;
  pizza = { dough: null, sauce: null, pieces: {} };
  byId('order').replaceChildren(makeDish(examples[round], true));
  lobby.hidden = true;
  kitchen.hidden = false;
  setStage('dough');
  byId('kitchen-title').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function select(button) {
  selected = button.dataset.supply;
  for (const btn of supplies.children) btn.setAttribute('aria-pressed', String(btn === button));
  guide.textContent = button.getAttribute('aria-label') + ' 선택. 작업대에 올려요.';
}

function normalized(element, point) {
  const bounds = element.getBoundingClientRect();
  return { x: (point.x - bounds.left) * 100 / bounds.width, y: (point.y - bounds.top) * 100 / bounds.height };
}

function inBoard(point) {
  const { x, y } = normalized(board, point);
  return Math.hypot(x - 50, y - 50) <= 48;
}

function overlaps(element, point) {
  const { x, y } = normalized(element, point);
  return x >= -5 && x <= 105 && y >= -5 && y <= 105;
}

function nearestSlot(point, snapInsideDough = false) {
  const dish = board.querySelector('.dish');
  if (!dish) return -1;
  const { x, y } = normalized(dish, point);
  if (Math.hypot(x - 50, y - 50) > 50) return -1;
  let match = -1;
  let distance = snapInsideDough ? Infinity : 17;
  slots.forEach(([sx, sy], i) => {
    const delta = Math.hypot(x - sx, y - sy);
    if (delta < distance) {
      match = i;
      distance = delta;
    }
  });
  return match;
}

function layTopping(id, slot) {
  if (slot < 0) return false;
  (pizza.pieces[slot] ??= []).push(id);
  oven.disabled = false;
  renderPizza(slot);
  guide.textContent = '토핑을 올렸어요. 더 올리거나 화덕에 넣어요.';
  play([660], .045);
  return true;
}

function touchToppingSlot(current, point, snapInsideDough = false) {
  const slot = nearestSlot(point, snapInsideDough);
  if (!current.touchedSlots.has(slot) && layTopping(current.supply, slot)) {
    current.touchedSlots.add(slot);
  }
}

function useIngredient(id, point, keyboard = false) {
  if (stage === 'dough' || stage === 'sauce') {
    const next = stage === 'dough' ? 'sauce' : 'toppings';
    pizza[stage] = id;
    setStage(next);
    play([stage === 'sauce' ? 420 : 540]);
    if (keyboard) supplies.firstElementChild?.focus({ preventScroll: true });
  } else if (stage === 'toppings') {
    const slot = keyboard
      ? Object.values(pizza.pieces).reduce((count, items) => count + items.length, 0) % slots.length
      : nearestSlot(point, true);
    layTopping(id, slot);
    scheduleHint();
  }
}

function bake() {
  if (stage !== 'toppings' || oven.disabled) return;
  setStage('baking');
  play([310, 430]);
  ovenTimer = setTimeout(() => {
    setStage('serve');
    play([650, 850]);
    cooked.focus({ preventScroll: true });
  }, bakeTime);
}

function serve() {
  if (stage !== 'serve') return;
  setStage('done');
  play([523.25, 659.25, 783.99, 1046.5]);
  replay.focus({ preventScroll: true });
}

function play(notes, volume = .075) {
  if (sound.getAttribute('aria-pressed') !== 'true' || !window.AudioContext) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    notes.forEach((frequency, i) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const t = audio.currentTime + i * .085;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + .023);
      gain.gain.exponentialRampToValueAtTime(.0001, t + .15);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(t);
      oscillator.stop(t + .16);
    });
  } catch {
    // Audio can be unavailable while the game is still playable.
  }
}

function hideGhost() {
  ghostMotion?.cancel();
  ghostMotion = null;
  ghost.hidden = true;
}

function moveGhost(point) {
  ghost.style.left = point.x + 'px';
  ghost.style.top = point.y + 'px';
}

function returnGhost(source, point, size) {
  if (motion.matches) {
    hideGhost();
    return;
  }
  const to = middle(source);
  moveGhost(point);
  const animation = ghost.animate([
    { left: point.x + 'px', top: point.y + 'px', opacity: 1 },
    { left: to.x + 'px', top: to.y + 'px', opacity: 0 },
  ], { duration: size > 100 ? 235 : 170, easing: 'ease-out' });
  ghostMotion = animation;
  animation.onfinish = () => { if (ghostMotion === animation) hideGhost(); };
}

kitchen.addEventListener('pointerdown', (event) => {
  if (drag || !event.isPrimary || event.button !== 0) return;
  skippedClick = null;
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const supply = button.dataset.supply;
  const dish = button === board && stage === 'toppings' && inBoard({ x: event.clientX, y: event.clientY }) && !oven.disabled ||
    button === cooked && stage === 'serve';
  if (!supply && !dish) return;
  hideGhost();
  drag = {
    button, id: event.pointerId, supply, stage, dish, moved: false, touchedSlots: new Set(),
    start: { x: event.clientX, y: event.clientY }, size: 64,
  };
  button.setPointerCapture(event.pointerId);
});

kitchen.addEventListener('pointermove', (event) => {
  if (drag?.id !== event.pointerId) return;
  const point = { x: event.clientX, y: event.clientY };
  if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 7) return;
  if (!drag.moved) {
    drag.moved = true;
    stopHint();
    if (drag.supply) select(drag.button);
    const visual = drag.dish ? makeDish(pizza, drag.stage === 'serve') : icon(drag.stage, drag.supply);
    drag.size = drag.dish ? Math.min(175, drag.button.getBoundingClientRect().width * .8) : 64;
    ghost.style.setProperty('--ghost-size', drag.size + 'px');
    ghost.replaceChildren(visual);
    ghost.hidden = false;
  }
  moveGhost(point);
  if (drag.supply && drag.stage === 'toppings') {
    touchToppingSlot(drag, point);
  }
});

kitchen.addEventListener('pointerup', (event) => {
  if (drag?.id !== event.pointerId) return;
  const current = drag;
  drag = null;
  if (!current.moved) return;
  skippedClick = current.button;
  const point = { x: event.clientX, y: event.clientY };
  if (current.supply && current.stage !== 'toppings' && inBoard(point)) {
    hideGhost();
    useIngredient(current.supply, point);
  } else if (current.dish && current.stage === 'toppings' && overlaps(oven, point)) {
    hideGhost();
    bake();
  } else if (current.dish && current.stage === 'serve' && overlaps(guest, point)) {
    hideGhost();
    serve();
  } else {
    if (current.supply && current.stage === 'toppings') {
      touchToppingSlot(current, point, current.touchedSlots.size === 0);
    }
    returnGhost(current.button, point, current.size);
    scheduleHint();
  }
});

kitchen.addEventListener('lostpointercapture', (event) => {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  hideGhost();
  scheduleHint();
});

kitchen.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const keyboard = event.detail === 0;
  if (!keyboard && skippedClick === button) {
    skippedClick = null;
    return;
  }
  if (button.dataset.supply) {
    select(button);
    scheduleHint(true);
    if (keyboard) board.focus({ preventScroll: true });
  } else if (button === board && selected) {
    useIngredient(selected, { x: event.clientX, y: event.clientY }, keyboard);
  } else if (button === oven) {
    bake();
  } else if (button === cooked) {
    scheduleHint();
  } else if (button === guest) {
    serve();
  }
});

byId('start').addEventListener('click', () => reset(0));
replay.addEventListener('click', () => reset((round + 1) % examples.length));
byId('home').addEventListener('click', () => {
  clearTimeout(ovenTimer);
  stopHint();
  hideGhost();
  drag = null;
  kitchen.hidden = true;
  lobby.hidden = false;
  byId('start').focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
sound.addEventListener('click', () => {
  const enabled = sound.getAttribute('aria-pressed') === 'true';
  sound.setAttribute('aria-pressed', String(!enabled));
  sound.firstElementChild.textContent = enabled ? '🔇' : '🔊';
});
window.addEventListener('resize', () => { if (!drag) scheduleHint(); });
kitchen.style.setProperty('--bake-time', bakeTime + 'ms');
