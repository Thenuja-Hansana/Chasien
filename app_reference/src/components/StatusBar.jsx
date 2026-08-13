export default function StatusBar() {
  return (
    <div
      style={{
        height: 44,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px 0 26px',
        fontFamily: 'var(--font-body)',
        fontSize: 13,
        fontWeight: 700,
        color: 'var(--color-text)',
        letterSpacing: '.01em',
      }}
    >
      <span>9:41</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
          <rect x="0" y="7" width="3" height="5" rx="1" />
          <rect x="4.6" y="5" width="3" height="7" rx="1" />
          <rect x="9.2" y="2.5" width="3" height="9.5" rx="1" />
          <rect x="13.8" y="0" width="3" height="12" rx="1" opacity=".35" />
        </svg>
        <svg width="15" height="12" viewBox="0 0 15 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M1 4.2a9 9 0 0 1 13 0" />
          <path d="M3.6 7a5.5 5.5 0 0 1 7.8 0" />
          <path d="M6.2 9.7a2 2 0 0 1 2.6 0" />
        </svg>
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
          <rect x=".7" y=".7" width="21" height="10.6" rx="3.2" stroke="currentColor" strokeOpacity=".4" strokeWidth="1.2" />
          <rect x="2.4" y="2.4" width="15" height="7.2" rx="2" fill="currentColor" />
          <path d="M23.4 4.2v3.6a2 2 0 0 0 0-3.6z" fill="currentColor" fillOpacity=".4" />
        </svg>
      </div>
    </div>
  );
}
