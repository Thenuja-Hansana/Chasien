import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import Icon from '../components/Icon';

const THEME_COLORS = ['#e08c4e', '#a3b585', 'var(--color-neutral-400)', 'var(--color-accent-400)', 'var(--color-accent-2-600)'];

const JOIN_TYPES = [
  { key: 'public', icon: 'globe', title: 'Public', desc: 'Listed in discovery, anyone joins' },
  { key: 'request', icon: 'lock', title: 'Request to join', desc: 'Listed, but mods approve' },
  { key: 'invite', icon: 'mail', title: 'Invite only', desc: 'Hidden from discovery' },
];

export default function CreateCommunity() {
  const navigate = useNavigate();
  const [name, setName] = useState('Dawn Patrol');
  const [accent, setAccent] = useState('#a3b585');
  const [joinType, setJoinType] = useState('public');
  const slug = useMemo(() => name.toLowerCase().replace(/[^a-z0-9]+/g, ''), [name]);

  function handleCreate(e) {
    e.preventDefault();
    navigate('/discover');
  }

  return (
    <div style={{ '--color-accent': accent, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 20px 14px' }}>
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="Close">
          <Icon name="close" size={22} />
        </button>
        <span style={{ flex: 1, fontFamily: 'var(--font-heading)', fontSize: 19 }}>New community</span>
      </div>
      <form onSubmit={handleCreate} className="screen-scroll" style={{ flex: 1, padding: '0 20px' }}>
        <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--color-divider)', marginBottom: 22 }}>
          <div style={{ height: 96, background: 'linear-gradient(140deg, var(--color-accent-2-500), var(--color-accent-2-900))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ padding: '7px 14px', borderRadius: 999, background: 'rgba(0,0,0,.4)', fontSize: 12, fontWeight: 700, display: 'flex', gap: 7, alignItems: 'center' }}>
              <Icon name="addPhoto" size={14} />
              Add banner
            </div>
          </div>
          <div style={{ background: 'var(--color-surface)', padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 46, height: 46, borderRadius: 16, background: 'var(--color-accent)', color: '#1d2415', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontSize: 19 }}>
              {name.trim()[0]?.toUpperCase() || 'D'}
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 17 }}>{name || 'Untitled community'}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.5)' }}>Preview · 1 member</div>
            </div>
          </div>
        </div>
        <div style={labelStyle}>Name</div>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ height: 50, fontSize: 15, borderRadius: 999, borderColor: 'var(--color-accent)', borderWidth: 1.5, marginBottom: 8 }}
        />
        <div style={{ fontSize: 12, color: 'rgba(242,230,212,.45)', paddingLeft: 6, marginBottom: 20 }}>
          chasien.app/<span style={{ color: 'var(--color-accent-2-300)' }}>{slug}</span>
        </div>
        <div style={labelStyle}>Theme</div>
        <div style={{ display: 'flex', gap: 11, marginBottom: 22 }}>
          {THEME_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setAccent(c)}
              aria-label={`Theme colour ${c}`}
              className="plain-btn"
              style={{ width: 38, height: 38, borderRadius: 999, background: c, boxShadow: accent === c ? `0 0 0 2px var(--color-bg), 0 0 0 4px ${c}` : 'none' }}
            />
          ))}
          <button type="button" className="plain-btn" style={{ width: 38, height: 38, borderRadius: 999, border: '1px dashed rgba(242,230,212,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Custom colour">
            <Icon name="plus" size={16} color="rgba(242,230,212,.55)" />
          </button>
        </div>
        <div style={labelStyle}>Who can join</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {JOIN_TYPES.map((j) => {
            const active = joinType === j.key;
            return (
              <button
                key={j.key}
                type="button"
                onClick={() => setJoinType(j.key)}
                className="plain-btn"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 15px',
                  borderRadius: 'var(--radius-md)',
                  background: active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent',
                  border: active ? '1.5px solid var(--color-accent)' : '1px solid var(--color-divider)',
                  width: '100%',
                }}
              >
                <Icon name={j.icon} size={19} color={active ? 'var(--color-accent)' : 'rgba(242,230,212,.6)'} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{j.title}</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.55)' }}>{j.desc}</div>
                </div>
                <div
                  style={{
                    width: 19,
                    height: 19,
                    borderRadius: 999,
                    background: active ? 'var(--color-accent)' : 'transparent',
                    border: active ? 'none' : '1.5px solid rgba(242,230,212,.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {active && <Icon name="check" size={12} color="#1d2415" strokeWidth={3.6} />}
                </div>
              </button>
            );
          })}
        </div>
      </form>
      <div style={{ padding: '14px 20px 32px' }}>
        <button
          type="button"
          onClick={handleCreate}
          className="pill-btn"
          style={{ width: '100%', height: 54, background: 'var(--color-accent)', color: '#1d2415', fontSize: 16, boxShadow: '0 8px 22px rgba(163,181,133,.25)' }}
        >
          Create community
        </button>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(242,230,212,.4)', marginBottom: 8 };
