export type ThemeKey = 'greenhouse' | 'creek' | 'moon';
export type HazardKind = 'stone' | 'root' | 'pool' | 'hedge' | 'mushroom' | 'moving' | 'bloom';
export type PickupKind = 'nectar' | 'rare' | 'hidden' | 'dew' | 'shield' | 'slow' | 'glow';

export interface HazardSpec {
  x: number;
  y: number;
  radius: number;
  kind: HazardKind;
  phase?: number;
}

export interface PickupSpec {
  x: number;
  y: number;
  kind: PickupKind;
}

export interface LevelSpec {
  id: number;
  theme: ThemeKey;
  title: string;
  note: string;
  target: number;
  parSeconds: number;
  fruit: Array<[number, number]>;
  extras: PickupSpec[];
  hazards: HazardSpec[];
}

export const THEMES: Record<ThemeKey, { name: string; subtitle: string; colors: [string, string, string, string] }> = {
  greenhouse: { name: '晨光温室', subtitle: '露水还挂在叶尖，路很宽，慢慢学会转弯。', colors: ['#c8dfb2', '#8daf78', '#f2dd9c', '#ecf3d8'] },
  creek: { name: '溪畔花园', subtitle: '沿着水声走，留意会移动的睡莲与花丛。', colors: ['#b4d9c6', '#6f9f8d', '#e7d18e', '#e2f1df'] },
  moon: { name: '月色植物园', subtitle: '夜色安静下来，萤光会替你照亮窄径。', colors: ['#8299a1', '#516e72', '#e3c995', '#cbd8c6'] },
};

export const LEVELS: LevelSpec[] = [
  {
    id: 1, theme: 'greenhouse', title: '第一阵风', note: '先摘三枚花蜜，再回到花门。', target: 3, parSeconds: 70,
    fruit: [[.29, .34], [.52, .66], [.72, .36]], extras: [{ x: .43, y: .43, kind: 'dew' }, { x: .64, y: .73, kind: 'rare' }, { x: .82, y: .73, kind: 'hidden' }],
    hazards: [{ x: .28, y: .78, radius: 26, kind: 'stone' }, { x: .5, y: .25, radius: 30, kind: 'mushroom' }, { x: .76, y: .78, radius: 25, kind: 'bloom' }],
  },
  {
    id: 2, theme: 'greenhouse', title: '蕨叶回旋', note: '绕过蕨叶，顺着浅色草径画一个弯。', target: 3, parSeconds: 76,
    fruit: [[.31, .69], [.54, .34], [.76, .68]], extras: [{ x: .48, y: .77, kind: 'shield' }, { x: .66, y: .28, kind: 'dew' }, { x: .83, y: .27, kind: 'hidden' }],
    hazards: [{ x: .26, y: .35, radius: 30, kind: 'root' }, { x: .5, y: .78, radius: 28, kind: 'stone' }, { x: .7, y: .41, radius: 31, kind: 'mushroom' }],
  },
  {
    id: 3, theme: 'greenhouse', title: '暖棚小径', note: '两块石头之间留有宽阔通道。', target: 4, parSeconds: 88,
    fruit: [[.26, .36], [.45, .68], [.65, .34], [.79, .61]], extras: [{ x: .36, y: .28, kind: 'rare' }, { x: .6, y: .76, kind: 'slow' }, { x: .83, y: .27, kind: 'hidden' }],
    hazards: [{ x: .34, y: .75, radius: 28, kind: 'stone' }, { x: .48, y: .25, radius: 28, kind: 'root' }, { x: .6, y: .76, radius: 27, kind: 'mushroom' }, { x: .77, y: .3, radius: 24, kind: 'bloom' }],
  },
  {
    id: 4, theme: 'greenhouse', title: '玻璃暖流', note: '花门边的花丛会轻轻摆动，经过前先看一眼。', target: 4, parSeconds: 90,
    fruit: [[.3, .68], [.48, .32], [.67, .68], [.79, .34]], extras: [{ x: .4, y: .55, kind: 'dew' }, { x: .7, y: .42, kind: 'glow' }, { x: .84, y: .76, kind: 'hidden' }],
    hazards: [{ x: .27, y: .32, radius: 26, kind: 'bloom' }, { x: .44, y: .77, radius: 29, kind: 'root' }, { x: .62, y: .29, radius: 30, kind: 'stone' }, { x: .75, y: .78, radius: 28, kind: 'moving', phase: 1.7 }],
  },
  {
    id: 5, theme: 'creek', title: '溪石之间', note: '水洼边缘很滑，绕开深色的水心。', target: 3, parSeconds: 82,
    fruit: [[.3, .34], [.52, .68], [.74, .38]], extras: [{ x: .4, y: .78, kind: 'shield' }, { x: .66, y: .73, kind: 'rare' }, { x: .83, y: .74, kind: 'hidden' }],
    hazards: [{ x: .29, y: .76, radius: 37, kind: 'pool' }, { x: .48, y: .25, radius: 29, kind: 'stone' }, { x: .68, y: .77, radius: 40, kind: 'pool' }],
  },
  {
    id: 6, theme: 'creek', title: '睡莲慢漂', note: '睡莲沿着短弧移动，柔和的光圈会预告位置。', target: 3, parSeconds: 85,
    fruit: [[.3, .68], [.53, .32], [.76, .66]], extras: [{ x: .41, y: .4, kind: 'dew' }, { x: .68, y: .3, kind: 'slow' }, { x: .83, y: .27, kind: 'hidden' }],
    hazards: [{ x: .26, y: .33, radius: 31, kind: 'root' }, { x: .49, y: .75, radius: 34, kind: 'moving', phase: 0 }, { x: .72, y: .36, radius: 37, kind: 'pool' }],
  },
  {
    id: 7, theme: 'creek', title: '风过花桥', note: '高花丛会按节奏开合，亮起时暂时不要穿过。', target: 4, parSeconds: 100,
    fruit: [[.28, .37], [.48, .68], [.68, .34], [.81, .64]], extras: [{ x: .38, y: .27, kind: 'rare' }, { x: .59, y: .76, kind: 'glow' }, { x: .83, y: .26, kind: 'hidden' }],
    hazards: [{ x: .3, y: .77, radius: 31, kind: 'pool' }, { x: .51, y: .27, radius: 33, kind: 'bloom' }, { x: .69, y: .77, radius: 28, kind: 'moving', phase: 2.2 }, { x: .78, y: .27, radius: 25, kind: 'stone' }],
  },
  {
    id: 8, theme: 'creek', title: '回水湾', note: '水路弯曲，发光孢子会短暂标出安全方向。', target: 4, parSeconds: 108,
    fruit: [[.29, .66], [.46, .34], [.64, .66], [.79, .36]], extras: [{ x: .38, y: .79, kind: 'glow' }, { x: .61, y: .27, kind: 'shield' }, { x: .84, y: .75, kind: 'hidden' }],
    hazards: [{ x: .27, y: .3, radius: 37, kind: 'pool' }, { x: .43, y: .78, radius: 28, kind: 'moving', phase: .6 }, { x: .6, y: .28, radius: 31, kind: 'root' }, { x: .76, y: .76, radius: 37, kind: 'pool' }],
  },
  {
    id: 9, theme: 'moon', title: '月牙廊', note: '路更窄了，收慢一点，让蛇身跟上弯道。', target: 3, parSeconds: 90,
    fruit: [[.3, .34], [.52, .67], [.74, .36]], extras: [{ x: .42, y: .4, kind: 'glow' }, { x: .65, y: .76, kind: 'dew' }, { x: .83, y: .74, kind: 'hidden' }],
    hazards: [{ x: .27, y: .77, radius: 33, kind: 'hedge' }, { x: .47, y: .25, radius: 35, kind: 'mushroom' }, { x: .68, y: .78, radius: 34, kind: 'hedge' }, { x: .81, y: .29, radius: 22, kind: 'stone' }],
  },
  {
    id: 10, theme: 'moon', title: '露光合奏', note: '两处月光花依次亮起，留意安全间隔。', target: 4, parSeconds: 105,
    fruit: [[.29, .67], [.47, .33], [.66, .67], [.8, .35]], extras: [{ x: .39, y: .4, kind: 'shield' }, { x: .71, y: .77, kind: 'rare' }, { x: .84, y: .26, kind: 'hidden' }],
    hazards: [{ x: .29, y: .31, radius: 30, kind: 'bloom' }, { x: .48, y: .76, radius: 30, kind: 'mushroom' }, { x: .68, y: .28, radius: 33, kind: 'bloom' }, { x: .78, y: .75, radius: 27, kind: 'root' }],
  },
  {
    id: 11, theme: 'moon', title: '静夜绕行', note: '窄径旁有缓慢巡游的菇灯，沿着它的光圈绕行。', target: 4, parSeconds: 114,
    fruit: [[.28, .36], [.47, .68], [.66, .34], [.81, .64]], extras: [{ x: .37, y: .79, kind: 'slow' }, { x: .73, y: .25, kind: 'glow' }, { x: .84, y: .78, kind: 'hidden' }],
    hazards: [{ x: .28, y: .76, radius: 32, kind: 'hedge' }, { x: .47, y: .25, radius: 29, kind: 'moving', phase: 3 }, { x: .65, y: .76, radius: 34, kind: 'bloom' }, { x: .8, y: .28, radius: 32, kind: 'moving', phase: 1.2 }],
  },
  {
    id: 12, theme: 'moon', title: '青岚归门', note: '最后一段花径，摘下隐藏果实，再回到青岚花门。', target: 5, parSeconds: 132,
    fruit: [[.26, .36], [.43, .68], [.59, .33], [.73, .69], [.82, .38]], extras: [{ x: .35, y: .27, kind: 'glow' }, { x: .58, y: .77, kind: 'shield' }, { x: .77, y: .26, kind: 'rare' }, { x: .85, y: .77, kind: 'hidden' }],
    hazards: [{ x: .27, y: .76, radius: 34, kind: 'hedge' }, { x: .42, y: .27, radius: 31, kind: 'moving', phase: 0 }, { x: .57, y: .76, radius: 31, kind: 'bloom' }, { x: .72, y: .27, radius: 32, kind: 'moving', phase: 2.5 }, { x: .83, y: .76, radius: 29, kind: 'stone' }],
  },
];

export const COSMETICS = [
  { id: 'fern', name: '青蕨纹', color: '#65895d', accent: '#b8d79a', stars: 0 },
  { id: 'amber', name: '琥珀点', color: '#aa7550', accent: '#f0c56d', stars: 5 },
  { id: 'moon', name: '月影鳞', color: '#536e7b', accent: '#c8d9bf', stars: 10 },
  { id: 'blossom', name: '山茶花', color: '#ad6c72', accent: '#f2c2ae', stars: 18 },
];

export function dateSeed(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
