import { GardenAudio } from './audio';
import { COSMETICS, LEVELS, THEMES, dateSeed, type LevelSpec } from './data';
import { getLevel, SnakeGame, type GameEvent, type GameMode } from './game';
import { InputController } from './input';
import { GardenRenderer } from './render';
import { DEFAULT_SETTINGS, SaveStore, type Settings } from './store';
import './styles.css';

type Screen = 'menu' | 'guide' | 'levels' | 'settings' | 'help' | 'playing' | 'paused' | 'result' | 'victory' | 'confirm';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found');

app.innerHTML = `
  <canvas id="garden-canvas" aria-hidden="true"></canvas>
  <div class="board-window" id="board-window" aria-hidden="true"></div>
  <header class="game-hud" id="game-hud" hidden>
    <div class="hud-title">
      <span class="hud-overline" id="hud-location">晨光温室 · 第 1 段</span>
      <strong id="hud-stage">第一阵风</strong>
      <small class="hud-mobile-summary"><span><span id="mobile-score">0</span> 分</span><span aria-hidden="true">·</span><span id="mobile-time">00:00</span></small>
    </div>
    <div class="hud-goal">
      <div class="hud-goal-label"><span id="hud-goal-label">花蜜果实</span><strong id="hud-goal-count">0 / 3</strong></div>
      <div class="meter"><span id="goal-meter"></span></div>
      <div class="hud-combo" id="hud-combo">连击待命</div>
    </div>
    <div class="hud-score"><span>本局得分</span><strong id="hud-score">0</strong><small id="hud-time">00:00</small></div>
    <div class="hud-boost"><span>露珠能量</span><div class="meter meter--amber"><span id="boost-meter"></span></div></div>
    <button class="icon-button pause-button" data-action="pause" aria-label="暂停游戏" title="暂停游戏">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
    </button>
  </header>
  <div class="game-status" id="game-status" hidden>
    <span class="status-dot"></span><span id="status-copy">护叶可挡一次碰撞</span><span id="status-time"></span>
  </div>
  <div class="touch-controls" id="touch-controls" hidden>
    <div class="stick-base" id="stick-base" role="application" aria-label="虚拟摇杆，拖动控制蛇头方向">
      <span class="stick-ring"></span><span class="stick-knob" id="stick-knob"></span>
      <span class="stick-label">转向</span>
    </div>
    <button class="boost-button" id="boost-button" type="button" aria-label="按住加速" title="按住加速">
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M18.2 3.8 7.8 17.4h7.1l-1.2 10.8 10.6-14h-7.5z" /></svg>
      <span>加速</span>
      <span class="boost-charge-track" aria-hidden="true"><span id="touch-boost-meter"></span></span>
    </button>
  </div>
  <div class="toast" id="toast" aria-live="polite"></div>
  <main class="screen-layer" id="screen-layer" aria-live="polite"></main>
`;

const canvas = app.querySelector<HTMLCanvasElement>('#garden-canvas')!;
const board = app.querySelector<HTMLElement>('#board-window')!;
const hud = app.querySelector<HTMLElement>('#game-hud')!;
const touchControls = app.querySelector<HTMLElement>('#touch-controls')!;
const status = app.querySelector<HTMLElement>('#game-status')!;
const screenLayer = app.querySelector<HTMLElement>('#screen-layer')!;
const toast = app.querySelector<HTMLElement>('#toast')!;
const save = new SaveStore();
const audio = new GardenAudio(save.data.settings);
const renderer = new GardenRenderer(canvas, board);
const stickBase = app.querySelector<HTMLElement>('#stick-base')!;
const stickKnob = app.querySelector<HTMLElement>('#stick-knob')!;
const boostButton = app.querySelector<HTMLButtonElement>('#boost-button')!;
const input = new InputController(stickBase, stickKnob, boostButton, () => togglePause());

let currentScreen: Screen = 'menu';
let currentMode: GameMode = 'campaign';
let game: SnakeGame | null = null;
let previousFrame = 0;
let uiTick = 0;
let toastTimer = 0;
let guideStep = 0;
let guideUsedBoost = false;
let tutorialWaitingForInput = false;
let pendingCampaignLevel = 1;
let hiddenFocus: HTMLElement | null = null;
let saveNoticeShown = false;

function icon(name: 'leaf' | 'arrow' | 'book' | 'sound' | 'pause' | 'close'): string {
  const paths: Record<typeof name, string> = {
    leaf: '<path d="M20.8 3.2C12.5 3.6 6 5.7 4 11.4c-1.6 4.6 1.2 8.8 5.8 8.7 6-.2 10.7-7.6 11-16.9Z"/><path d="M4.6 21c3.3-5 6.9-8.6 12.3-11.7"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    book: '<path d="M4 5.5c3.7-1 6.5-.4 8 1.5v13c-1.7-1.8-4.2-2.5-8-1.4zM20 5.5c-3.7-1-6.5-.4-8 1.5v13c1.7-1.8 4.2-2.5 8-1.4z"/>',
    sound: '<path d="M5 10v4h4l5 4V6l-5 4zM18 9a4 4 0 0 1 0 6M20 6a8 8 0 0 1 0 12"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function setScreen(screen: Screen, content: string, title: string): void {
  hiddenFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  currentScreen = screen;
  app!.classList.toggle('is-active', ['guide', 'playing', 'paused', 'result', 'victory', 'confirm'].includes(screen));
  hud.hidden = !['playing', 'paused', 'result', 'victory'].includes(screen);
  touchControls.hidden = screen !== 'playing' && screen !== 'guide';
  status.hidden = screen !== 'playing' || !game || !hasActiveEffect();
  input.setEnabled(screen === 'playing' || screen === 'guide');
  screenLayer.innerHTML = content;
  screenLayer.setAttribute('aria-label', title);
  screenLayer.setAttribute('role', 'region');
  const viewport = renderer.resize();
  game?.resize(viewport.height, viewport.scale);
  if (screen !== 'playing') {
    window.setTimeout(() => screenLayer.querySelector<HTMLElement>('h1, h2, button')?.focus({ preventScroll: true }), 30);
  } else if (hiddenFocus && hiddenFocus.isConnected) hiddenFocus.focus({ preventScroll: true });
  refreshRendererMode();
  if (!hud.hidden || screen === 'guide') updateHud(true);
}

function refreshRendererMode(): void {
  renderer.setGame(game, game ? currentMode : 'menu', save.data.settings.lowMotion, save.data.settings.quality === 'gentle', save.data.settings.reduceFlash);
}

function formatTime(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function showToast(message: string, duration = 2400): void {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), duration);
}

function homeMarkup(): string {
  const completed = Object.keys(save.data.cleared).length;
  const totalStars = save.stars;
  const date = dateSeed();
  const dailyRecord = save.data.dailyBest[date] ?? 0;
  return `
    <section class="home-layout">
      <div class="brand-mark"><img class="brand-mark-icon" src="/brand-mark.svg" alt="" /><span>青岚蛇园</span><i></i></div>
      <p class="eyebrow home-tagline"><span class="garden-tagline">微风 · 花径 · 慢慢长大</span><span class="phone-tagline">手机推荐竖屏 · 双手轻松转向</span></p>
      <h1>跟着风，<br><em>绕一段路。</em></h1>
      <p class="home-description">穿过一座会呼吸的花园。摘下花蜜，顺着身体的弧线，安全地回到花门。</p>
      <div class="home-progress" aria-label="花园巡游进度">
        <div><strong>${String(completed).padStart(2, '0')}</strong><span>已通关</span></div>
        <span class="progress-separator"></span>
        <div><strong>${String(totalStars).padStart(2, '0')}</strong><span>收集星光</span></div>
        <span class="progress-separator"></span>
        <div><strong>12</strong><span>段花径</span></div>
      </div>
      <div class="home-actions">
        <button class="primary-button" data-action="campaign-start">${save.data.tutorialComplete ? '继续花园巡游' : '开始一段花径'}<span>${icon('arrow')}</span></button>
        <button class="quiet-button" data-action="levels-open">${icon('book')}<span>关卡簿</span></button>
      </div>
      <div class="mode-buttons" aria-label="更多游玩模式">
        <button class="mode-link" data-action="endless-start"><span class="mode-icon mode-icon--wind">↝</span><span><strong>无尽拾光</strong><small>看看可以走多远 <b>纪录 ${save.data.endlessBest.toLocaleString()}</b></small></span>${icon('arrow')}</button>
        <button class="mode-link" data-action="daily-start"><span class="mode-icon mode-icon--sun">${icon('leaf')}</span><span><strong>今日花径</strong><small>${date} · 今日 ${dailyRecord.toLocaleString()} 分</small></span>${icon('arrow')}</button>
      </div>
      <div class="home-footer">
        <button class="text-button" data-action="help-open">怎么游玩</button>
        <span></span>
        <button class="text-button" data-action="settings-open">设置</button>
        <span></span>
        <button class="sound-quick" data-action="sound-toggle" aria-label="${save.data.settings.sound > 0 ? '关闭音效' : '开启音效'}">${icon('sound')}<small>${save.data.settings.sound > 0 ? '声音开着' : '声音关闭'}</small></button>
      </div>
    </section>
    <div class="scene-caption"><span class="caption-dot"></span>一座小小的、会随季节换色的花园</div>
    ${save.warning && !saveNoticeShown ? `<div class="save-warning" role="status">${escapeHtml(save.warning)}</div>` : ''}
  `;
}

function menu(): void {
  currentMode = 'campaign';
  game = null;
  refreshRendererMode();
  setScreen('menu', homeMarkup(), '青岚蛇园主菜单');
  if (save.warning && !saveNoticeShown) {
    saveNoticeShown = true;
    window.setTimeout(() => showToast(save.warning ?? '', 5200), 150);
  }
}

function startCampaign(levelId = 1): void {
  pendingCampaignLevel = levelId;
  if (!save.data.tutorialComplete) {
    startTutorial();
    return;
  }
  beginGame('campaign', getLevel(levelId));
}

function startTutorial(): void {
  guideStep = 0;
  guideUsedBoost = false;
  tutorialWaitingForInput = true;
  const safeLesson: LevelSpec = { ...getLevel(1), title: '学会顺风转弯', note: '先轻轻转向，跟着光点走。', target: 1, fruit: [[.45, .32]], extras: [], hazards: [] };
  beginGame('tutorial', safeLesson, true);
  renderGuide();
}

function beginGame(mode: GameMode, level?: LevelSpec, fromGuide = false): void {
  currentMode = mode;
  app!.classList.add('is-active');
  hud.hidden = false;
  touchControls.hidden = false;
  const view = renderer.resize();
  game = new SnakeGame({
    mode,
    level,
    settings: save.data.settings,
    height: view.height,
    scale: view.scale,
    seed: mode === 'daily' ? `qinglan-${dateSeed()}` : undefined,
  });
  renderer.setGame(game, mode, save.data.settings.lowMotion, save.data.settings.quality === 'gentle', save.data.settings.reduceFlash);
  audio.unlock();
  if (!fromGuide) {
    setScreen('playing', '', '游戏进行中');
    input.setEnabled(true);
  }
  uiTick = 0;
  updateHud(true);
}

function renderGuide(): void {
  const steps = [
    ['轻轻拐弯', '输入后蛇就会向前。试着轻推摇杆，或按 W、↑，让蛇头慢慢转向。'],
    ['收下花蜜', '靠近前方的花蜜果实就能摘下它。连续收集会让连击加分。'],
    ['短按加速', '露珠会补充加速能量。电脑按住 Shift，手机点住“加速”，松开就会减速。'],
    ['回到花门', '花门亮起后即可通关。避开场地边缘和较早的身体；巡游阶段还要留意花园中的其他蛇。'],
  ];
  const [title, copy] = steps[Math.min(guideStep, steps.length - 1)];
  setScreen('guide', `
    <section class="guide-banner" aria-label="引导提示">
      <div class="guide-step"><span>引导关</span><b>${guideStep + 1}</b><i>/</i><small>4</small></div>
      <div class="guide-copy"><strong>${title}</strong><p>${copy}</p></div>
      <button class="text-button guide-skip" data-action="guide-skip">${guideStep < 3 ? '跳过引导' : '进入巡游'} ${icon('arrow')}</button>
      <button class="icon-button guide-pause" data-action="pause" aria-label="暂停游戏">${icon('pause')}</button>
    </section>
  `, '引导关');
  input.setEnabled(true);
}

function advanceGuide(event?: GameEvent): void {
  if (currentScreen !== 'guide') return;
  let nextStep = guideStep;
  if (guideStep === 0 && game && game.head.x > 340) nextStep = 1;
  if (event === 'collect' || event === 'combo') nextStep = Math.max(nextStep, 2);
  if (event === 'boost') nextStep = Math.max(nextStep, 3);
  nextStep = Math.min(3, nextStep);
  if (nextStep !== guideStep) {
    guideStep = nextStep;
    renderGuide();
  }
}

function skipGuide(): void {
  save.data.tutorialComplete = true;
  save.save();
  game = null;
  startCampaign(pendingCampaignLevel);
}

function pauseGame(fromFocusLoss = false): void {
  if (currentScreen !== 'playing' && currentScreen !== 'guide') return;
  const wasGuide = currentScreen === 'guide';
  if (wasGuide) {
    setScreen('paused', pauseMarkup('guide'), '引导已暂停');
    return;
  }
  setScreen('paused', pauseMarkup('game'), '游戏已暂停');
  if (fromFocusLoss) showToast('游戏已暂停，返回页面后可继续。');
}

function togglePause(): void {
  if (currentScreen === 'playing' || currentScreen === 'guide') pauseGame();
  else if (currentScreen === 'paused') {
    if (currentMode === 'tutorial') renderGuide();
    else setScreen('playing', '', '游戏进行中');
  }
}

function pauseMarkup(kind: 'game' | 'guide'): string {
  return `<section class="modal-panel compact-panel"><div class="panel-sprig">${icon('leaf')}</div><p class="eyebrow">花园歇一会</p><h2>先听一会儿风。</h2><p class="panel-description">暂停时蛇和计时都会停下来。准备好后，可以接着走。</p>
    <button class="primary-button" data-action="resume">继续这一局 ${icon('arrow')}</button>
    <div class="button-row"><button class="secondary-button" data-action="restart">重新开始本关</button><button class="secondary-button" data-action="home">返回菜单</button></div>
    ${kind === 'guide' ? `<button class="text-button center-text" data-action="guide-skip">跳过引导，进入巡游</button>` : `<button class="text-button center-text" data-action="give-up">结束本次挑战</button>`}
  </section>`;
}

function toggleSettings(): void {
  save.data.settings.music = save.data.settings.music > 0 ? 0 : 0.25;
  save.data.settings.sound = save.data.settings.sound > 0 ? 0 : 0.65;
  persistSettings();
  if (currentScreen === 'menu') menu();
}

function levelSelect(): void {
  const groups: Array<[string, string, number]> = [['greenhouse', '晨光温室', 1], ['creek', '溪畔花园', 5], ['moon', '月色植物园', 9]];
  const sections = groups.map(([themeKey, name, first]) => {
    const theme = THEMES[themeKey as keyof typeof THEMES];
    const tiles = LEVELS.filter((level) => level.id >= first && level.id < first + 4).map((level) => {
      const unlocked = level.id <= save.data.unlockedLevel;
      const stars = save.data.cleared[String(level.id)] ?? 0;
      return `<button class="level-tile ${unlocked ? '' : 'is-locked'}" data-action="level-start" data-level="${level.id}" ${unlocked ? '' : 'disabled'} aria-label="第 ${level.id} 段 ${escapeHtml(level.title)}${unlocked ? `，${stars} 星` : '，尚未解锁'}">
        <span class="level-number">${String(level.id).padStart(2, '0')}${unlocked ? '' : '<small>锁</small>'}</span><strong>${escapeHtml(level.title)}</strong><span class="tile-stars" aria-label="${stars} 星">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
      </button>`;
    }).join('');
    return `<section class="region-row"><div class="region-intro"><span class="region-dot" style="--region-color:${theme.colors[1]}"></span><div><h3>${name}</h3><p>${theme.subtitle}</p></div><small>${String(first).padStart(2, '0')}—${String(first + 3).padStart(2, '0')}</small></div><div class="level-grid">${tiles}</div></section>`;
  }).join('');
  setScreen('levels', `
    <section class="content-panel level-panel"><div class="panel-header"><div><p class="eyebrow">一座花园，十二段花径</p><h2>关卡簿</h2></div><button class="icon-button light-icon" data-action="back" aria-label="返回">${icon('close')}</button></div>
      <div class="level-scroll">${sections}</div>
      <div class="level-footer"><span>${Object.keys(save.data.cleared).length} / 12 已通关</span><span>每关收集指定花蜜，再回到花门</span></div>
    </section>
  `, '关卡簿');
}

function settingsScreen(): void {
  const s = save.data.settings;
  const skins = COSMETICS.map((skin) => {
    const unlocked = save.data.skinUnlocks.includes(skin.id);
    const selected = save.data.selectedSkin === skin.id;
    return `<button class="skin-choice ${selected ? 'is-selected' : ''} ${unlocked ? '' : 'is-locked'}" data-action="skin-select" data-skin="${skin.id}" ${unlocked ? '' : 'disabled'} aria-label="${skin.name}${unlocked ? selected ? '，当前选择' : '' : `，需 ${skin.stars} 星解锁`}">
      <span class="skin-swatch" style="--skin:${skin.color};--skin-accent:${skin.accent}"><i></i></span><strong>${skin.name}</strong><small>${unlocked ? selected ? '正在使用' : '已解锁' : `收集 ${skin.stars} 星`}</small>
    </button>`;
  }).join('');
  setScreen('settings', `
    <section class="content-panel settings-panel"><div class="panel-header"><div><p class="eyebrow">手感 · 声音 · 画面</p><h2>设置</h2></div><button class="icon-button light-icon" data-action="back" aria-label="返回">${icon('close')}</button></div>
      <div class="settings-scroll">
        <div class="setting-section"><h3>操控</h3>
          ${rangeControl('speed', '移动速度', s.speed, .75, 1.3, .05, `${Math.round(s.speed * 100)}%`)}
          ${rangeControl('sensitivity', '转向灵敏度', s.sensitivity, .65, 1.4, .05, `${Math.round(s.sensitivity * 100)}%`)}
        </div>
        <div class="setting-section"><h3>声音</h3>
          ${rangeControl('music', '背景音乐', s.music, 0, 1, .05, s.music === 0 ? '已关闭' : `${Math.round(s.music * 100)}%`)}
          ${rangeControl('sound', '游戏音效', s.sound, 0, 1, .05, s.sound === 0 ? '已关闭' : `${Math.round(s.sound * 100)}%`)}
        </div>
        <div class="setting-section"><h3>画面与辅助</h3>
          <label class="select-control"><span><strong>画质</strong><small>低配设备可选择轻量画质</small></span><select name="quality"><option value="standard" ${s.quality === 'standard' ? 'selected' : ''}>细致</option><option value="gentle" ${s.quality === 'gentle' ? 'selected' : ''}>轻量</option></select></label>
          ${toggleControl('lowMotion', '减少动态效果', '降低环境摆动、飘动和起伏')}
          ${toggleControl('reduceFlash', '降低闪光', '采集和加速时不显示亮闪')}
          ${toggleControl('cameraShake', '镜头轻震', '碰撞时短促摇动场景')}
        </div>
        <div class="setting-section"><div class="section-heading-row"><h3>蛇身花纹</h3><small>只改变外观</small></div><div class="skin-grid">${skins}</div></div>
      </div>
      <div class="settings-footer"><button class="text-button" data-action="settings-default">重置为默认设置</button><button class="danger-text" data-action="confirm-reset">重新开始全部进度</button></div>
    </section>
  `, '游戏设置');
}

function rangeControl(key: keyof Settings, label: string, value: number, min: number, max: number, step: number, description: string): string {
  return `<label class="range-control"><span class="range-label"><strong>${label}</strong><output data-output="${key}">${description}</output></span><input type="range" name="${key}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}" /></label>`;
}

function toggleControl(key: keyof Settings, label: string, description: string): string {
  const checked = save.data.settings[key] ? 'checked' : '';
  return `<label class="toggle-control"><span><strong>${label}</strong><small>${description}</small></span><input type="checkbox" name="${key}" ${checked} /><i aria-hidden="true"></i></label>`;
}

function helpScreen(): void {
  setScreen('help', `
    <section class="modal-panel help-panel"><div class="panel-header"><div><p class="eyebrow">轻轻转弯，顺路采集</p><h2>怎么游玩</h2></div><button class="icon-button light-icon" data-action="back" aria-label="返回">${icon('close')}</button></div>
      <div class="help-list">
        <div class="help-row"><span class="help-illustration turn-mark">↗</span><div><strong>连续转向</strong><p>蛇会持续向前。用 WASD 或方向键控制转向；转弯会逐渐跟上，不会瞬间折返。</p></div></div>
        <div class="help-row"><span class="help-illustration fruit-mark"><i></i></span><div><strong>摘下花蜜</strong><p>每关收集进度中标明的花蜜果实，连续收集有连击加分。花门亮起后，回到右侧出口。</p></div></div>
        <div class="help-row"><span class="help-illustration boost-mark">${icon('arrow')}</span><div><strong>短暂加速</strong><p>电脑按住 Shift，手机点住“加速”按钮。露珠可以补充能量；加速时转向稍慢。</p></div></div>
        <div class="help-row"><span class="help-illustration leaf-mark">${icon('leaf')}</span><div><strong>留意危险</strong><p>避开场地边缘、石块、水洼、其他巡游蛇和较早的身体；靠近头部的身体段会受到保护。其他蛇沿花纹轨迹巡游；进入警戒范围后会追击，头顶出现感叹标记时要立刻躲开。被它们碰到会直接判负，护叶也挡不住。</p></div></div>
      </div>
      <button class="primary-button" data-action="back">知道了 ${icon('arrow')}</button>
    </section>
  `, '操作说明');
}

function getStars(): number {
  if (!game || !game.level) return 0;
  let stars = 1;
  if (game.stats.time <= game.level.parSeconds) stars += 1;
  if (game.stats.hidden && game.stats.collisions === 0) stars += 1;
  return stars;
}

function handleGameEnd(kind: 'win' | 'crash'): void {
  input.setEnabled(false);
  if (!game) return;
  if (currentMode === 'tutorial' && kind === 'crash') {
    setScreen('result', `
      <section class="modal-panel result-panel"><div class="result-rosette">${icon('leaf')}</div><p class="eyebrow">花径尽头在这里</p><h2>轻轻转回来，再试一次。</h2><p class="panel-description">边缘会结束这一小段练习。你可以从起点重来，也可以直接开始正式巡游。</p>
        <button class="primary-button" data-action="restart">重来这一小段 ${icon('arrow')}</button><button class="text-button center-text" data-action="guide-skip">跳过引导，进入巡游</button>
      </section>
    `, '引导碰撞');
    return;
  }
  if (currentMode === 'campaign' && kind === 'crash') {
    setScreen('result', `
      <section class="modal-panel result-panel"><div class="result-rosette">${icon('leaf')}</div><p class="eyebrow">${game.level ? `${THEMES[game.level.theme].name} · 第 ${game.level.id} 段` : '花园巡游'}</p><h2>这段花径，再走一次。</h2><p class="panel-description">蛇头碰到了边缘或危险。本次花蜜不会计入通关进度；重新开始后，可以从头规划路线。</p>
        <div class="result-stats"><div><strong>本次用时</strong><small>${formatTime(game.stats.time)}</small></div><div><strong>已收集花蜜</strong><small>${game.stats.nectar} / ${game.target}</small></div></div>
        <button class="primary-button" data-action="restart">重新开始本关 ${icon('arrow')}</button><button class="text-button center-text" data-action="home">返回菜单</button>
      </section>
    `, '本关结束');
    return;
  }
  if (currentMode === 'tutorial' && kind === 'win') {
    save.data.tutorialComplete = true;
    save.save();
    audio.play('win');
    setScreen('result', `
      <section class="modal-panel result-panel"><div class="result-rosette">${icon('leaf')}</div><p class="eyebrow">轻轻一拐，整座花园就醒了</p><h2>学会顺着风走了。</h2><p class="panel-description">接下来去晨光温室，开始第一段正式花径。</p>
      <div class="result-stats"><div><strong>花蜜已采到</strong><small>花门已经亮起</small></div><div><strong>${guideUsedBoost ? '加速已试过' : '可以试试加速'}</strong><small>${guideUsedBoost ? '松开按钮即可恢复常速' : '电脑按住 Shift，手机按住加速按钮'}</small></div></div>
      <button class="primary-button" data-action="campaign-continue">进入花园巡游 ${icon('arrow')}</button>
    </section>
    `, '引导完成');
    return;
  }
  if (currentMode === 'campaign' && kind === 'win') {
    const levelId = game.level?.id ?? 1;
    const stars = getStars();
    const oldStars = save.data.cleared[String(levelId)] ?? 0;
    save.data.cleared[String(levelId)] = Math.max(oldStars, stars);
    save.data.unlockedLevel = Math.min(12, Math.max(save.data.unlockedLevel, levelId + 1));
    save.refreshCosmetics();
    save.save();
    audio.play('win');
    if (levelId === 12) {
      const totalTime = LEVELS.reduce((sum, level) => sum + (level.id === levelId ? game!.stats.time : 0), 0);
      setScreen('victory', `
        <section class="modal-panel victory-panel"><div class="win-garden-mark">${icon('leaf')}</div><p class="eyebrow">晨光、溪水與月色，都走过了</p><h2>青岚，回到你身边。</h2><p class="panel-description">十二段花径都已留下足迹。花园会记住每一阵风。</p>
          <div class="victory-score"><span>本次收集</span><strong>${save.stars}<small>星</small></strong><i>12 / 12 段花径</i></div>
          <div class="result-stats"><div><strong>最后一关</strong><small>${formatTime(totalTime)}</small></div><div><strong>本关最高连击</strong><small>${game.stats.maxCombo}</small></div></div>
          <button class="primary-button" data-action="campaign-replay">重新从温室出发 ${icon('arrow')}</button><button class="text-button center-text" data-action="home">回到花园门口</button>
        </section>
      `, '完整胜利');
      return;
    }
    const starsHtml = Array.from({ length: 3 }, (_, i) => `<span class="${i < stars ? 'earned' : ''}">★</span>`).join('');
    setScreen('result', `
      <section class="modal-panel result-panel"><div class="result-rosette">${icon('leaf')}</div><p class="eyebrow">花门开了 · ${THEMES[game.level!.theme].name} 第 ${game.level!.id} 段</p><h2>${escapeHtml(game.level!.title)}，走得真好。</h2>
        <div class="star-score" aria-label="${stars} 星">${starsHtml}</div>
        <div class="star-criteria"><span class="${game.stats.nectar >= game.level!.target ? 'is-met' : ''}">完成目标收集 <b>1 星</b></span><span class="${game.stats.time <= game.level!.parSeconds ? 'is-met' : ''}">用时 ${formatTime(game.stats.time)}（目标 ${formatTime(game.level!.parSeconds)}）<b>1 星</b></span><span class="${game.stats.hidden && game.stats.collisions === 0 ? 'is-met' : ''}">${game.stats.hidden ? '找到隐藏果实' : '隐藏果实尚未找到'}，${game.stats.collisions === 0 ? '无碰撞' : '本次有碰撞'} <b>1 星</b></span></div>
        <div class="result-stats"><div><strong>花蜜与稀有果</strong><small>${game.stats.nectar} 枚 · ${game.stats.rare} 枚</small></div><div><strong>最高连击</strong><small>${game.stats.maxCombo} 连 · ${game.stats.score.toLocaleString()} 分</small></div></div>
        <div class="button-row"><button class="secondary-button" data-action="restart">再走一次</button><button class="primary-button button-row-main" data-action="next-level">继续下一段 ${icon('arrow')}</button></div>
        <button class="text-button center-text" data-action="levels-open">打开关卡簿</button>
      </section>
    `, '关卡完成结算');
    return;
  }
  if (currentMode === 'endless') {
    const score = game.stats.score;
    const isRecord = score > save.data.endlessBest;
    save.data.endlessBest = Math.max(score, save.data.endlessBest);
    save.save();
    audio.play('crash');
    setScreen('result', challengeResultsMarkup('无尽拾光', score, isRecord, `${formatTime(game.stats.time)} 生存 · ${game.stats.nectar + game.stats.rare} 枚果实`), '无尽模式结算');
    return;
  }
  if (currentMode === 'daily') {
    const key = dateSeed();
    const score = game.stats.score;
    const isRecord = score > (save.data.dailyBest[key] ?? 0);
    save.data.dailyBest[key] = Math.max(score, save.data.dailyBest[key] ?? 0);
    save.save();
    audio.play('crash');
    setScreen('result', challengeResultsMarkup('今日花径', score, isRecord, `${key} · ${formatTime(game.stats.time)} 生存`), '每日挑战结算');
  }
}

function challengeResultsMarkup(title: string, score: number, isRecord: boolean, caption: string): string {
  return `<section class="modal-panel result-panel challenge-result"><div class="result-rosette">${icon('leaf')}</div><p class="eyebrow">${title} · 花径暂歇</p><h2>${isRecord ? '新的个人纪录。' : '下一次会走得更远。'}</h2><div class="challenge-score"><strong>${score.toLocaleString()}</strong><span>分</span><small>${caption}</small></div>
    <div class="result-stats"><div><strong>最长连击</strong><small>${game?.stats.maxCombo ?? 0}</small></div><div><strong>撞上危险</strong><small>${game?.stats.collisions ?? 0} 次</small></div></div>
    <button class="primary-button" data-action="challenge-restart">${title === '今日花径' ? '再挑战今日路线' : '再试一次'} ${icon('arrow')}</button><button class="text-button center-text" data-action="home">回到主菜单</button>
  </section>`;
}

function confirmResetScreen(): void {
  setScreen('confirm', `<section class="modal-panel confirm-panel"><div class="confirm-mark">!</div><p class="eyebrow">这一步无法撤销</p><h2>要把花园重新整理好吗？</h2><p class="panel-description">已通关的关卡、星级、纪录、装饰和操作设置都会清除。清除后会从第一段花径重新开始。</p><div class="button-row"><button class="secondary-button" data-action="back">先不清除</button><button class="danger-button" data-action="reset-confirmed">清除全部进度</button></div></section>`, '确认清除进度');
}

function persistSettings(): void {
  save.save();
  if (save.warning) showToast(save.warning, 3600);
  audio.setSettings(save.data.settings);
  game?.setSettings(save.data.settings);
  refreshRendererMode();
  updateHud(true);
}

function restoreDefaultSettings(): void {
  save.data.settings = { ...DEFAULT_SETTINGS };
  persistSettings();
  settingsScreen();
}

function selectSkin(id: string): void {
  if (!save.data.skinUnlocks.includes(id)) return;
  save.data.selectedSkin = id;
  persistSettings();
  settingsScreen();
}

function hasActiveEffect(): boolean {
  return Boolean(game && (game.effectShield > 0 || game.effectSlow > 0 || game.effectGlow > 0));
}

function updateHud(force = false): void {
  if (!game || (!force && currentScreen !== 'playing' && currentScreen !== 'guide')) return;
  const theme = game.level ? THEMES[game.level.theme] : { name: game.mode === 'daily' ? '今日花径' : game.mode === 'endless' ? '无尽拾光' : '引导关' };
  app!.querySelector('#hud-location')!.textContent = game.level && game.mode === 'campaign' ? `${theme.name} · 第 ${game.level.id} 段` : theme.name;
  app!.querySelector('#hud-stage')!.textContent = game.level?.title ?? (game.mode === 'daily' ? dateSeed() : '随风前行');
  const isChallenge = game.mode === 'endless' || game.mode === 'daily';
  app!.querySelector('#hud-goal-label')!.textContent = isChallenge ? '收集果实' : '花蜜果实';
  app!.querySelector('#hud-goal-count')!.textContent = isChallenge ? `${game.stats.nectar + game.stats.rare} 枚` : `${game.stats.nectar} / ${game.target}`;
  const goalFill = isChallenge ? Math.min(100, ((game.stats.nectar + game.stats.rare) % 5) * 20) : Math.min(100, game.stats.nectar / Math.max(1, game.target) * 100);
  app!.querySelector<HTMLElement>('#goal-meter')!.style.width = `${goalFill}%`;
  app!.querySelector('#hud-combo')!.textContent = game.stats.combo > 1 ? `${game.stats.combo} 连击 · ${Math.floor((game.stats.combo - 1) / 3) * 25 + 100}%` : '连击待命';
  app!.querySelector('#hud-score')!.textContent = game.stats.score.toLocaleString();
  app!.querySelector('#hud-time')!.textContent = formatTime(game.stats.time);
  app!.querySelector('#mobile-score')!.textContent = game.stats.score.toLocaleString();
  app!.querySelector('#mobile-time')!.textContent = formatTime(game.stats.time);
  app!.querySelector<HTMLElement>('#boost-meter')!.style.width = `${Math.min(100, game.boostCharge / 5 * 100)}%`;
  const chargePercent = Math.round(Math.min(100, game.boostCharge / 5 * 100));
  app!.querySelector<HTMLElement>('#touch-boost-meter')!.style.width = `${chargePercent}%`;
  boostButton.setAttribute('aria-label', `按住加速，剩余能量 ${chargePercent}%`);
  const active: string[] = [];
  if (game.effectShield > 0) active.push(`护叶 ${Math.ceil(game.effectShield)} 秒`);
  if (game.effectSlow > 0) active.push(`慢步 ${Math.ceil(game.effectSlow)} 秒`);
  if (game.effectGlow > 0) active.push(`安全光迹 ${Math.ceil(game.effectGlow)} 秒`);
  if (game.invulnerable > 0) active.push('护叶挡住了一次碰撞');
  status.hidden = currentScreen !== 'playing' || active.length === 0;
  app!.querySelector('#status-copy')!.textContent = active.join(' · ');
  app!.querySelector('#status-time')!.textContent = '';
}

function restartGame(): void {
  if (currentMode === 'campaign') startCampaign(game?.level?.id ?? 1);
  else if (currentMode === 'tutorial') startTutorial();
  else beginGame(currentMode, undefined);
}

function campaignStartFromMenu(): void {
  startCampaign(save.data.unlockedLevel);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

function handleAction(target: HTMLElement): void {
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (!action) return;
  switch (action) {
    case 'campaign-start': campaignStartFromMenu(); break;
    case 'campaign-continue': game = null; startCampaign(pendingCampaignLevel); break;
    case 'campaign-replay': game = null; startCampaign(1); break;
    case 'levels-open': levelSelect(); break;
    case 'level-start': {
      const id = Number(target.closest<HTMLElement>('[data-level]')?.dataset.level);
      if (id && id <= save.data.unlockedLevel) startCampaign(id);
      break;
    }
    case 'endless-start': beginGame('endless'); break;
    case 'daily-start': beginGame('daily'); break;
    case 'settings-open': settingsScreen(); break;
    case 'help-open': helpScreen(); break;
    case 'sound-toggle': toggleSettings(); break;
    case 'back': {
      if (currentScreen === 'confirm') settingsScreen();
      else menu();
      break;
    }
    case 'pause': pauseGame(); break;
    case 'resume': togglePause(); break;
    case 'restart': restartGame(); break;
    case 'home': menu(); break;
    case 'give-up': {
      if (game && currentMode !== 'campaign' && currentMode !== 'tutorial') {
        game.ended = 'crash';
        handleGameEnd('crash');
      } else menu();
      break;
    }
    case 'guide-skip': skipGuide(); break;
    case 'next-level': startCampaign(Math.min(12, (game?.level?.id ?? 1) + 1)); break;
    case 'challenge-restart': beginGame(currentMode); break;
    case 'settings-default': restoreDefaultSettings(); break;
    case 'confirm-reset': confirmResetScreen(); break;
    case 'reset-confirmed': save.clear(); settingsScreen(); showToast(save.warning ?? '进度已重新开始。'); break;
    case 'skin-select': selectSkin(target.closest<HTMLElement>('[data-skin]')?.dataset.skin ?? 'fern'); break;
  }
}

function handleSettingsInput(target: HTMLInputElement | HTMLSelectElement): void {
  const key = target.name as keyof Settings;
  if (!key) return;
  if (target instanceof HTMLInputElement && target.type === 'range') {
    const val = Number(target.value);
    if (key === 'speed' || key === 'sensitivity' || key === 'music' || key === 'sound') {
      save.data.settings[key] = val;
      const output = target.closest('.range-control')?.querySelector('output');
      if (output) output.textContent = key === 'music' || key === 'sound' ? val === 0 ? '已关闭' : `${Math.round(val * 100)}%` : `${Math.round(val * 100)}%`;
    }
  } else if (target instanceof HTMLInputElement && target.type === 'checkbox') {
    if (key === 'lowMotion' || key === 'reduceFlash' || key === 'cameraShake') save.data.settings[key] = target.checked;
  } else if (target instanceof HTMLSelectElement && key === 'quality') {
    save.data.settings.quality = target.value as Settings['quality'];
    renderer.resize();
  }
  persistSettings();
}

screenLayer.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target as HTMLElement : null;
  if (target) handleAction(target);
});
hud.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
  if (target) handleAction(target);
});
screenLayer.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) handleSettingsInput(target);
});
screenLayer.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) handleSettingsInput(target);
});
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Escape' || currentScreen === 'playing' || currentScreen === 'guide') return;
  if (currentScreen === 'paused') togglePause();
  else if (currentScreen !== 'menu') menu();
});
window.addEventListener('resize', () => {
  const old = renderer.viewport;
  const next = renderer.resize();
  game?.resize(next.height, next.scale);
  if (game && Math.abs(old.height - next.height) > 0.1) updateHud(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (currentScreen === 'playing' || currentScreen === 'guide')) pauseGame(true);
});
window.addEventListener('blur', () => {
  if (currentScreen === 'playing' || currentScreen === 'guide') pauseGame(true);
});

function frame(timestamp: number): void {
  const dt = previousFrame === 0 ? 0 : Math.min(.09, (timestamp - previousFrame) / 1000);
  previousFrame = timestamp;
  if ((currentScreen === 'playing' || currentScreen === 'guide') && game) {
    const snapshot = input.snapshot();
    if (currentScreen === 'guide' && tutorialWaitingForInput && (snapshot.direction || snapshot.boost)) tutorialWaitingForInput = false;
    const events = currentScreen === 'guide' && tutorialWaitingForInput ? [] : game.update(dt, snapshot);
    if (currentScreen === 'guide') advanceGuide();
    for (const event of events) {
      audio.play(event);
      renderer.feedback(event, game.head, timestamp);
      if (event === 'collect') showToast('花蜜 +100 · 连击继续', 900);
      if (event === 'rare') showToast('找到稀有果实', 1100);
      if (event === 'dew') showToast('露珠为加速槽充能', 1000);
      if (event === 'power') showToast('拾取效果已启用', 1100);
      if (event === 'boost') showToast('加速中 · 注意转弯', 1000);
      if (currentScreen === 'guide' && event === 'boost') guideUsedBoost = true;
      if (currentScreen === 'guide' && (event === 'collect' || event === 'combo' || event === 'boost')) advanceGuide(event);
      if (event === 'crash') handleGameEnd('crash');
      if (event === 'win') handleGameEnd('win');
    }
    if ((currentScreen === 'playing' || currentScreen === 'guide') && game) {
      if (uiTick <= 0) {
        updateHud();
        uiTick = .1;
      }
      uiTick -= dt;
    }
  }
  renderer.render(timestamp);
  window.requestAnimationFrame(frame);
}

renderer.resize();
refreshRendererMode();
menu();
window.requestAnimationFrame(frame);
