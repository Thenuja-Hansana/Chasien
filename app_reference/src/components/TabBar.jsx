import { Link } from 'react-router-dom';
import Icon from './Icon';

const TABS = [
  { label: 'Home', icon: 'homeTab', to: (c) => `/c/${c}` },
  { label: 'Explore', icon: 'exploreTab', to: () => '/discover' },
  { label: 'Post', icon: 'postTab', to: (c) => `/c/${c}/create-post` },
  { label: 'Chats', icon: 'chatsTab', to: () => '/chats' },
  { label: 'You', icon: 'youTab', to: (c, u) => `/u/${u}` },
];

export default function TabBar({ active = 'Home', communityId = 'grit-club', userId = 'mara' }) {
  return (
    <div
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        padding: '10px 18px 0',
        height: 74,
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-divider)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.label === active;
        const color = isActive ? 'var(--color-accent)' : 'color-mix(in srgb, var(--color-text) 42%, transparent)';
        return (
          <Link
            key={tab.label}
            to={tab.to(communityId, userId)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
              paddingTop: 6,
              textDecoration: 'none',
              color,
            }}
          >
            <Icon name={tab.icon} size={24} color={color} />
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color }}>
              {tab.label}
            </span>
            <div style={{ width: 5, height: 5, borderRadius: 999, background: isActive ? 'var(--color-accent)' : 'transparent' }} />
          </Link>
        );
      })}
    </div>
  );
}
