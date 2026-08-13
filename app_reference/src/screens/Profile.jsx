import { useNavigate, useParams } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import TabBar from '../components/TabBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { USERS, COMMUNITIES, SPACE_LABEL } from '../data/mock';

const MEMBERSHIPS = [
  { id: 'grit-club', meta: 'Owner · 842 members', badge: 'Owner' },
  { id: 'ilford-nights', meta: '1,204 members' },
  { id: 'sourdough-sunday', meta: 'Private · 318 members' },
  { id: 'alfama-steps', meta: 'Invite only · 96 members' },
];

export default function Profile() {
  const { userId = 'mara' } = useParams();
  const navigate = useNavigate();
  const user = USERS[userId] || USERS.mara;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div className="screen-scroll" style={{ padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 16px' }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>{user.handle}</span>
          <button type="button" className="icon-btn" onClick={() => navigate('/c/grit-club/settings')} aria-label="Settings">
            <Icon name="settings" size={21} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <Avatar gradient={user.gradient} letter={user.name[0]} size={84} ring />
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>128</div>
              <div style={{ fontSize: 11, color: 'rgba(242,230,212,.5)' }}>posts</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{MEMBERSHIPS.length}</div>
              <div style={{ fontSize: 11, color: 'rgba(242,230,212,.5)' }}>{SPACE_LABEL.toLowerCase()}</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>341</div>
              <div style={{ fontSize: 11, color: 'rgba(242,230,212,.5)' }}>friends</div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 3 }}>{user.name}</div>
        {user.bio && <div style={{ fontSize: 14, lineHeight: 1.5, color: 'rgba(242,230,212,.7)', marginBottom: 14 }}>{user.bio}</div>}
        <div style={{ display: 'flex', gap: 9, marginBottom: 22 }}>
          <button type="button" className="pill-btn" style={{ flex: 1, height: 40, background: 'var(--color-accent)', color: '#241305', fontSize: 13.5 }}>
            Edit profile
          </button>
          <button type="button" className="pill-btn" style={{ flex: 1, height: 40, border: '1px solid var(--color-divider)', fontSize: 13.5 }}>
            Share
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{SPACE_LABEL}</span>
          <span style={{ fontSize: 12, color: 'rgba(242,230,212,.45)' }}>{MEMBERSHIPS.length} joined</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, paddingBottom: 20 }}>
          {MEMBERSHIPS.map((m) => {
            const c = COMMUNITIES[m.id];
            return (
              <button key={m.id} type="button" onClick={() => navigate(`/c/${m.id}`)} className="plain-btn" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <Avatar gradient={c.gradient} letter={c.letter} shape="square" size={42} />
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.5)' }}>{m.meta}</div>
                </div>
                {m.badge && (
                  <span style={{ padding: '4px 11px', borderRadius: 999, background: `color-mix(in srgb, ${c.accent} 22%, transparent)`, color: 'var(--color-accent-400)', fontSize: 11, fontWeight: 700 }}>
                    {m.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <TabBar active="You" userId={user.id} />
    </div>
  );
}
