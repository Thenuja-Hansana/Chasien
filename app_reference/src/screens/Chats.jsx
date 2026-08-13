import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import TabBar from '../components/TabBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { CHATS, USERS, COMMUNITIES } from '../data/mock';

const FILTERS = ['All', 'Unread', 'Communities', 'DMs'];
const unreadCount = CHATS.filter((c) => c.unread).length;

export default function Chats() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');

  const visible = useMemo(() => {
    if (filter === 'Unread') return CHATS.filter((c) => c.unread);
    if (filter === 'Communities') return CHATS.filter((c) => c.kind === 'community');
    if (filter === 'DMs') return CHATS.filter((c) => c.kind === 'dm');
    return CHATS;
  }, [filter]);

  const pinned = visible.filter((c) => c.pinned);
  const today = visible.filter((c) => !c.pinned);

  function renderRow(chat) {
    const user = chat.kind === 'dm' ? USERS[chat.user] : null;
    const community = chat.kind === 'community' ? COMMUNITIES[chat.communityId] : null;
    return (
      <button
        key={chat.id}
        type="button"
        onClick={() => navigate(`/chats/${chat.id}`)}
        className="plain-btn"
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', background: chat.pinned ? 'rgba(224,140,78,.07)' : 'transparent', cursor: 'pointer' }}
      >
        <Avatar
          gradient={user ? user.gradient : chat.gradient}
          letter={user ? user.name[0] : chat.letter}
          shape={chat.shape || 'circle'}
          size={50}
          dot={!!user?.online}
        />
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{chat.title}</span>
            {chat.pinned && <Icon name="bookmark" size={12} color="rgba(242,230,212,.45)" filled />}
            {chat.muted && <Icon name="bellSlash" size={13} color="rgba(242,230,212,.4)" />}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(242,230,212,.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4 }}>
            {chat.read && <Icon name="check" size={13} color="var(--color-accent-2)" strokeWidth={3.4} />}
            {chat.lastSender && (
              <span style={{ color: community ? `color-mix(in srgb, ${community.accent} 85%, white)` : 'var(--color-accent-300)', fontWeight: 600 }}>{chat.lastSender}:</span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.last}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flex: 'none' }}>
          <span style={{ fontSize: 11, color: 'rgba(242,230,212,.45)' }}>{chat.time}</span>
          {chat.unread ? (
            <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: 'var(--color-accent)', color: '#241305', fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {chat.unread}
            </span>
          ) : null}
        </div>
      </button>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div style={{ padding: '4px 18px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28, letterSpacing: '-.02em' }}>Chats</span>
          <div style={{ display: 'flex', gap: 14 }}>
            <Icon name="search" size={21} />
            <Icon name="edit" size={21} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`chip ${filter === f ? 'chip-active' : 'chip-outline'}`} onClick={() => setFilter(f)}>
              {f} {f === 'Unread' && <span style={{ color: filter === f ? 'inherit' : 'var(--color-accent-300)' }}>{unreadCount}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="screen-scroll">
        {pinned.length > 0 && (
          <>
            <div style={sectionLabel}>Pinned</div>
            {pinned.map(renderRow)}
          </>
        )}
        {today.length > 0 && (
          <>
            <div style={sectionLabel}>Today</div>
            {today.map(renderRow)}
          </>
        )}
        {visible.length === 0 && <div style={{ padding: 24, fontSize: 13, color: 'rgba(242,230,212,.5)' }}>No chats here yet.</div>}
      </div>
      <TabBar active="Chats" />
    </div>
  );
}

const sectionLabel = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'rgba(242,230,212,.4)',
  padding: '8px 18px 4px',
};
