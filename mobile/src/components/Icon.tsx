import Svg, { Circle, Path, Rect } from 'react-native-svg';

// Ported 1:1 from app_reference/src/components/Icon.jsx — same shape data,
// SVG primitives swapped for react-native-svg's.
type Shape =
  | { t: 'path'; d: string; fill?: true }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const ICONS: Record<string, Shape[]> = {
  back: [{ t: 'path', d: 'M15 5l-7 7 7 7' }],
  close: [{ t: 'path', d: 'M6 6l12 12M18 6 6 18' }],
  plus: [{ t: 'path', d: 'M12 5v14M5 12h14' }],
  dotsH: [
    { t: 'circle', cx: 5, cy: 12, r: 1.4 },
    { t: 'circle', cx: 12, cy: 12, r: 1.4 },
    { t: 'circle', cx: 19, cy: 12, r: 1.4 },
  ],
  dotsV: [
    { t: 'circle', cx: 12, cy: 5, r: 1.4 },
    { t: 'circle', cx: 12, cy: 12, r: 1.4 },
    { t: 'circle', cx: 12, cy: 19, r: 1.4 },
  ],
  search: [
    { t: 'circle', cx: 11, cy: 11, r: 7 },
    { t: 'path', d: 'm20 20-3.6-3.6' },
  ],
  heart: [{ t: 'path', d: 'M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z' }],
  comment: [{ t: 'path', d: 'M21 12a8 8 0 0 1-11.7 7.1L3.2 21l1.9-6.2A8 8 0 1 1 21 12z' }],
  bookmark: [{ t: 'path', d: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z' }],
  send: [{ t: 'path', d: 'M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8z' }],
  edit: [{ t: 'path', d: 'M17 3.5 20.5 7 9 18.5H5.5V15z' }],
  camera: [
    { t: 'rect', x: 3, y: 5, width: 18, height: 14, rx: 3 },
    { t: 'path', d: 'm3 16 5-5 4 4 3-3 6 6' },
    { t: 'circle', cx: 9, cy: 9.5, r: 1.4 },
  ],
  addPhoto: [
    { t: 'rect', x: 3, y: 5, width: 18, height: 15, rx: 3 },
    { t: 'circle', cx: 12, cy: 12.5, r: 3.4 },
  ],
  location: [
    { t: 'path', d: 'M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z' },
    { t: 'circle', cx: 12, cy: 10, r: 2.4 },
  ],
  lock: [
    { t: 'path', d: 'M5 11V8a7 7 0 0 1 14 0v3' },
    { t: 'rect', x: 4, y: 11, width: 16, height: 10, rx: 3 },
  ],
  clock: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'path', d: 'M12 7v5l3.2 2' },
  ],
  globe: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'path', d: 'M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18' },
  ],
  mail: [{ t: 'path', d: 'M4 6h16v12H4zM4 7l8 6 8-6' }],
  bell: [
    { t: 'path', d: 'M4 9a8 8 0 0 1 16 0v5l2 3H2l2-3z' },
    { t: 'path', d: 'M10 21h4' },
  ],
  bellSlash: [{ t: 'path', d: 'M4 9a8 8 0 0 1 16 0v5l2 3H2l2-3zM3 3l18 18' }],
  attach: [{ t: 'path', d: 'M20.5 11.5 12 20a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.4-7.4' }],
  mic: [{ t: 'path', d: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3' }],
  emoji: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'path', d: 'M8.6 14.2a4.4 4.4 0 0 0 6.8 0M9.4 9.6h.01M14.6 9.6h.01' },
  ],
  check: [{ t: 'path', d: 'M20 6 9 17l-5-5' }],
  checkDouble: [
    { t: 'path', d: 'M1 6l3.4 3.4L11 3' },
    { t: 'path', d: 'M8 8.6 9.6 10 18 1.6' },
  ],
  eye: [
    { t: 'path', d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z' },
    { t: 'circle', cx: 12, cy: 12, r: 2.6 },
  ],
  apple: [{ t: 'path', fill: true, d: 'M16.4 12.8c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.1 2.5-1.8 3-.5 7.6 1.3 10.1.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.2 3.1-2.5.6-.9 1.1-2 1.1-2.1s-2.6-1-2.6-3.6z' }],
  google: [{ t: 'path', d: 'M21 12.2H12v3.4h5.2A5.2 5.2 0 1 1 12 6.8c1.3 0 2.5.5 3.4 1.3' }],
  chevronRight: [{ t: 'path', d: 'm9 6 6 6-6 6' }],
  chevronDown: [{ t: 'path', d: 'm6 9 6 6 6-6' }],
  homeTab: [{ t: 'path', d: 'M3 10.6 12 3.2l9 7.4V20a1 1 0 0 1-1 1h-4.6v-6H8.6v6H4a1 1 0 0 1-1-1z' }],
  exploreTab: [{ t: 'path', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m4 5-2.2 6.2L7.6 16l2.2-6.2z' }],
  postTab: [{ t: 'path', d: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1M12 8.4v7.2M8.4 12h7.2' }],
  chatsTab: [{ t: 'path', d: 'M21 12a8 8 0 0 1-11.7 7.1L3.2 21l1.9-6.2A8 8 0 1 1 21 12z' }],
  youTab: [{ t: 'path', d: 'M12 4.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2M4.9 20a7.1 7.1 0 0 1 14.2 0' }],
  settings: [
    { t: 'circle', cx: 12, cy: 12, r: 3.2 },
    {
      t: 'path',
      d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 3h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z',
    },
  ],
};

type IconProps = {
  name: keyof typeof ICONS;
  size?: number;
  color?: string;
  filled?: boolean;
  strokeWidth?: number;
};

export default function Icon({ name, size = 20, color = '#f2e6d4', filled = false, strokeWidth = 2.75 }: IconProps) {
  const shapes = ICONS[name];
  if (!shapes) return null;
  const fillOnly = shapes.some((s) => s.t === 'path' && s.fill);
  const fill = filled || fillOnly ? color : 'none';
  const stroke = fillOnly ? 'none' : color;
  const sw = fillOnly ? 0 : strokeWidth;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {shapes.map((s, i) => {
        if (s.t === 'path') return <Path key={i} d={s.d} />;
        if (s.t === 'circle') return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} />;
        if (s.t === 'rect') return <Rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} />;
        return null;
      })}
    </Svg>
  );
}
