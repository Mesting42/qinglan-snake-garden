import { COSMETICS } from './data';

export interface Settings {
  speed: number;
  sensitivity: number;
  music: number;
  sound: number;
  quality: 'standard' | 'gentle';
  lowMotion: boolean;
  reduceFlash: boolean;
  cameraShake: boolean;
}

export interface SaveData {
  version: number;
  tutorialComplete: boolean;
  unlockedLevel: number;
  cleared: Record<string, number>;
  endlessBest: number;
  dailyBest: Record<string, number>;
  skinUnlocks: string[];
  selectedSkin: string;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 1,
  sensitivity: 1,
  music: 0.25,
  sound: 0.65,
  quality: 'standard',
  lowMotion: false,
  reduceFlash: false,
  cameraShake: true,
};

export function freshSave(): SaveData {
  return {
    version: 1, tutorialComplete: false, unlockedLevel: 1, cleared: {}, endlessBest: 0, dailyBest: {},
    skinUnlocks: ['fern'], selectedSkin: 'fern', settings: { ...DEFAULT_SETTINGS },
  };
}

export class SaveStore {
  data: SaveData;
  available = true;
  warning: string | null = null;
  private readonly key = 'qinglan-snake-garden-v1';

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return freshSave();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (parsed.version !== 1 || typeof parsed !== 'object') throw new Error('save version');
      const sourceSettings = parsed.settings && typeof parsed.settings === 'object'
        ? parsed.settings as Partial<Record<keyof Settings, unknown>>
        : {};
      const range = (key: 'speed' | 'sensitivity' | 'music' | 'sound', min: number, max: number): number => {
        const value = sourceSettings[key];
        return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : DEFAULT_SETTINGS[key];
      };
      const settings: Settings = {
        speed: range('speed', .75, 1.3),
        sensitivity: range('sensitivity', .65, 1.4),
        music: range('music', 0, 1),
        sound: range('sound', 0, 1),
        quality: sourceSettings.quality === 'gentle' ? 'gentle' : 'standard',
        lowMotion: typeof sourceSettings.lowMotion === 'boolean' ? sourceSettings.lowMotion : DEFAULT_SETTINGS.lowMotion,
        reduceFlash: typeof sourceSettings.reduceFlash === 'boolean' ? sourceSettings.reduceFlash : DEFAULT_SETTINGS.reduceFlash,
        cameraShake: typeof sourceSettings.cameraShake === 'boolean' ? sourceSettings.cameraShake : DEFAULT_SETTINGS.cameraShake,
      };
      const validSkins = new Set(COSMETICS.map((skin) => skin.id));
      const skinUnlocks = Array.isArray(parsed.skinUnlocks) ? parsed.skinUnlocks.filter((id): id is string => typeof id === 'string' && validSkins.has(id)) : ['fern'];
      const selectedSkin = typeof parsed.selectedSkin === 'string' && skinUnlocks.includes(parsed.selectedSkin) ? parsed.selectedSkin : 'fern';
      const cleared = Object.fromEntries(Object.entries(parsed.cleared ?? {}).filter(([id, stars]) => /^\d+$/.test(id) && typeof stars === 'number' && stars >= 1 && stars <= 3).map(([id, stars]) => [id, Math.floor(stars as number)]));
      return {
        ...freshSave(), ...parsed,
        tutorialComplete: parsed.tutorialComplete === true,
        unlockedLevel: Math.max(1, Math.min(12, Number(parsed.unlockedLevel) || 1)),
        cleared,
        endlessBest: Math.max(0, Number(parsed.endlessBest) || 0),
        dailyBest: Object.fromEntries(Object.entries(parsed.dailyBest ?? {}).filter(([, score]) => typeof score === 'number' && score >= 0)),
        skinUnlocks: skinUnlocks.length ? skinUnlocks : ['fern'], selectedSkin, settings,
      };
    } catch {
      this.available = false;
      this.warning = '存档无法读取，当前进度会保存在本次打开期间。可从设置重置损坏的存档。';
      return freshSave();
    }
  }

  save(): void {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(this.data));
      this.available = true;
      this.warning = null;
    } catch {
      this.available = false;
      this.warning = '浏览器暂时无法写入存档，本次仍可继续游玩。';
    }
  }

  clear(): void {
    this.data = freshSave();
    try {
      window.localStorage.removeItem(this.key);
      this.available = true;
      this.warning = null;
    } catch {
      this.available = false;
      this.warning = '本地存储不可用，已在当前页面重置进度。';
    }
  }

  get stars(): number {
    return Object.values(this.data.cleared).reduce((sum, value) => sum + value, 0);
  }

  refreshCosmetics(): void {
    const earned = COSMETICS.filter((skin) => this.stars >= skin.stars).map((skin) => skin.id);
    this.data.skinUnlocks = [...new Set([...this.data.skinUnlocks, ...earned])];
    this.save();
  }
}
