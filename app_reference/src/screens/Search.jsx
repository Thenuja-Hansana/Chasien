import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import TabBar from '../components/TabBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { COMMUNITIES, SPACE_LABEL, SEARCH_COMMUNITIES } from '../data/mock';

const TABS = [SPACE_LABEL, 'People', 'Posts'];
const TILE_GRADIENTS = [
  ['var(--color-accent-700)', 'var(--color-neutral-900)'],
  ['var(--color-accent-2-600)', 'var(--color-accent-2-900)'],
  ['var(--color-neutral-700)', 'var(--color-neutral-900)'],
  ['var(--color-accent-600)', 'var(--color-accent-900)'],
  ['var(--color-accent-2-700)', '#1b1713'],
  ['var(--color-neutral-800)', 'var(--color-neutral-900)'],
];

export default function Search() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || 'bouldering');
  const [tab, setTab] = useState(SPACE_LABEL);
  const [joined, setJoined] = useState(() => {
    const init = {};
    for (const id in COMMUNITIES) init[id] = COMMUNITIES[id].joined;
    return init;
  });

  const results = useMemo(() => {
    const base = query.trim()
      ? Object.values(COMMUNITIES).filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
      : SEARCH_COMMUNITIES.map((id) => COMMUNITIES[id]);
    return base.length ? base : SEARCH_COMMUNITIES.map((id) => COMMUNITIES[id]);
  }, [query]);

  function toggleJoin(id, e) {
    e.stopPropagation();
    setJoined((j) => ({ ...j, [id]: !j[id] }));
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div style={{ padding: '4px 18px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, height: 46, borderRadius: 999, background: 'var(--color-surface)', border: '1.5px solid var(--color-accent)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px' }}>
            <Icon name="search" size={18} color="var(--color-accent)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', font: 'inherit', fontSize: 14.5 }}
            />
            {query && (
              <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear">
                <Icon name="close" size={16} color="rgba(242,230,212,.5)" />
              </button>
            )}
          </div>
          <button type="button" className="plain-btn" onClick={() => navigate(-1)} style={{ fontSize: 14, color: 'rgba(242,230,212,.6)' }}>
            Cancel
          </button>
        </div>
        <div className="seg" style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--color-surface)', borderRadius: 999, border: '1px solid var(--color-divider)' }}>
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="plain-btn"
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '7px 0',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 700,
                background: tab === t ? 'var(--color-accent)' : 'transparent',
                color: tab === t ? '#241305' : 'rgba(242,230,212,.5)',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="screen-scroll" style={{ padding: '0 18px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(242,230,212,.4)', padding: '8px 0 8px' }}>
          {results.length} communities
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginBottom: 20 }}>
          {results.map((c, i) => (
            <button key={c.id} type="button" onClick={() => navigate(`/c/${c.id}`)} className="plain-btn" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
              <Avatar gradient={c.gradient} letter={c.letter} shape="square" size={46} />
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.5)' }}>
                  {c.description} · {c.members.toLocaleString()}
                </div>
              </div>
              <span
                onClick={(e) => toggleJoin(c.id, e)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  background: i === 0 ? 'var(--color-accent)' : 'rgba(242,230,212,.08)',
                  color: i === 0 ? '#241305' : 'var(--color-text)',
                  fontFamily: 'var(--font-heading)',
                  fontSize: 12.5,
                  flex: 'none',
                }}
              >
                {joined[c.id] ? 'Joined' : 'Join'}
              </span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(242,230,212,.4)', padding: '0 0 8px' }}>Posts mentioning it</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, paddingBottom: 20 }}>
          {TILE_GRADIENTS.map(([from, to], i) => (
            <div key={i} style={{ aspectRatio: '1', background: `linear-gradient(140deg, ${from}, ${to})` }} />
          ))}
        </div>
      </div>
      <TabBar active="Explore" />
    </div>
  );
}
