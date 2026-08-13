const GRADIENTS = {
  mara: ['#e08c4e', 'var(--color-accent-700)'],
  tobi: ['var(--color-accent-600)', 'var(--color-accent-900)'],
  nadia: ['var(--color-accent-2-600)', 'var(--color-accent-2-900)'],
  kwame: ['var(--color-neutral-700)', 'var(--color-neutral-900)'],
  rui: ['var(--color-accent-700)', 'var(--color-neutral-900)'],
  eve: ['var(--color-neutral-400)', 'var(--color-neutral-800)'],
  grit: ['#e08c4e', 'var(--color-accent-700)'],
  ilford: ['var(--color-accent-2-500)', 'var(--color-accent-2-900)'],
  sourdough: ['var(--color-neutral-400)', 'var(--color-neutral-800)'],
  alfama: ['var(--color-accent-400)', 'var(--color-accent-2-900)'],
  bike: ['var(--color-accent-2-500)', 'var(--color-accent-2-800)'],
  wallrats: ['var(--color-accent-2-500)', 'var(--color-accent-2-900)'],
  plastic: ['var(--color-neutral-400)', 'var(--color-neutral-800)'],
};

export default function Avatar({
  gradient,
  letter,
  size = 40,
  shape = 'circle',
  ring = false,
  dot = false,
  style,
}) {
  const [from, to] = GRADIENTS[gradient] || GRADIENTS.mara;
  const radius = shape === 'circle' ? '999px' : Math.max(10, size * 0.34) + 'px';
  const inner = (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: radius,
        background: `linear-gradient(140deg, ${from}, ${to})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-heading)',
        fontSize: size * 0.4,
        color: '#f6e7d2',
        flex: 'none',
      }}
    >
      {letter}
    </div>
  );

  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none', ...style }}>
      {ring ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '999px',
            padding: 2.5,
            background:
              'conic-gradient(from 200deg, var(--color-accent), var(--color-accent-2), var(--color-accent-300), var(--color-accent))',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '999px',
              border: '2.5px solid var(--color-surface)',
              overflow: 'hidden',
            }}
          >
            {inner}
          </div>
        </div>
      ) : (
        inner
      )}
      {dot && (
        <div
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: '999px',
            background: 'var(--color-accent-2)',
            border: '2.5px solid var(--color-bg)',
          }}
        />
      )}
    </div>
  );
}
