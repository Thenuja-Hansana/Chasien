import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import TabBar from '../components/TabBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { COMMUNITIES, spaceLower } from '../data/mock';

const GRID = ['grit-club', 'ilford-nights', 'sourdough-sunday', 'alfama-steps'];
const CHIPS = ['Near you', 'Sport', 'Photo', 'Food'];

const JOIN_LABEL = { Public: 'Join', Private: 'Request', Invite: 'Join' };

export default function Discover() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('Near you');
  const [joined, setJoined] = useState(() => {
    const init = {};
    for (const id in COMMUNITIES) init[id] = COMMUNITIES[id].joined;
    return init;
  });

  function toggleJoin(id, e) {
    e.stopPropagation();
    setJoined((j) => ({ ...j, [id]: !j[id] }));
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div style={{ padding: '6px 20px 12px' }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 30, letterSpacing: '-.02em', marginBottom: 12 }}>
          Find your {spaceLower}
        </div>
        <div style={{ height: 46, borderRadius: 999, background: 'var(--color-surface)', border: '1px solid var(--color-divider)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', marginBottom: 12 }}>
          <Icon name="search" size={18} color="rgba(242,230,212,.45)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search communities"
            aria-label="Search communities"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', font: 'inherit', fontSize: 14 }}
            onKeyDown={(e) => e.key === 'Enter' && navigate(`/search?q=${encodeURIComponent(query)}`)}
          />
        </div>
        <div style={{ display: 'flex', gap: 7, overflow: 'hidden' }}>
          {CHIPS.map((c) => (
            <button key={c} type="button" className={`chip ${chip === c ? 'chip-active' : 'chip-outline'}`} onClick={() => setChip(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="screen-scroll" style={{ padding: '0 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {GRID.map((id) => {
            const c = COMMUNITIES[id];
            const isJoined = joined[id];
            return (
              <div
                key={id}
                className="plain-btn"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/c/${id}`)}
                style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--color-surface)', border: '1px solid var(--color-divider)', cursor: 'pointer' }}
              >
                <div style={{ height: 88, background: `linear-gradient(140deg, ${c.accent}99, var(--color-neutral-900))`, display: 'flex', alignItems: 'flex-end', padding: 10 }}>
                  <Avatar gradient={c.gradient} letter={c.letter} shape="square" size={34} />
                </div>
                <div style={{ padding: '10px 12px 12px' }}>
                  <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16, marginBottom: 3 }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.5)', marginBottom: 10 }}>
                    {c.members.toLocaleString()} members · {c.visibility}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => toggleJoin(id, e)}
                    className="pill-btn"
                    style={{
                      width: '100%',
                      height: 32,
                      fontSize: 12.5,
                      background: isJoined ? 'transparent' : 'var(--color-accent)',
                      color: isJoined ? 'var(--color-accent-300)' : '#241305',
                      border: isJoined ? '1px solid var(--color-accent-2)' : 'none',
                    }}
                  >
                    {isJoined ? 'Joined' : JOIN_LABEL[c.visibility]}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '20px 0 12px' }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 19 }}>Busy right now</span>
          <span style={{ fontSize: 12, color: 'var(--color-accent-300)', fontWeight: 700 }}>See all</span>
        </div>
        <div
          className="plain-btn"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/c/bike-kitchen-berlin')}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--color-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-divider)', marginBottom: 20, cursor: 'pointer' }}
        >
          <Avatar gradient="bike" letter="B" shape="square" size={44} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Bike Kitchen Berlin</div>
            <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.5)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-accent-2)' }} />
              31 posting today
            </div>
          </div>
          <button type="button" onClick={(e) => toggleJoin('bike-kitchen-berlin', e)} className="pill-btn" style={{ padding: '8px 16px', background: 'rgba(242,230,212,.08)', fontSize: 12.5 }}>
            {joined['bike-kitchen-berlin'] ? 'Joined' : 'Join'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => navigate('/create-community')}
          className="pill-btn"
          style={{ width: '100%', height: 48, border: '1.5px dashed var(--color-divider)', gap: 8, fontSize: 13.5, marginBottom: 20 }}
        >
          <Icon name="plus" size={16} />
          Start your own community
        </button>
      </div>
      <TabBar active="Explore" />
    </div>
  );
}
