import { useState } from 'react';
import { Link } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import TabBar from '../components/TabBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { NOTIFICATIONS, USERS, spaceSingular } from '../data/mock';

export default function Notifications() {
  const [items, setItems] = useState(NOTIFICATIONS);

  function respond(id) {
    setItems((list) => list.filter((n) => n.id !== id));
  }

  const groups = [...new Set(items.map((n) => n.group))];

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div style={{ padding: '4px 20px 12px' }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28, letterSpacing: '-.02em' }}>Activity</span>
      </div>
      <div className="screen-scroll">
        {groups.map((group) => (
          <div key={group}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(242,230,212,.4)', padding: '6px 20px 6px' }}>{group}</div>
            {items
              .filter((n) => n.group === group)
              .map((n) => {
                const user = n.user ? USERS[n.user] : null;
                return (
                  <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', background: n.unread ? 'rgba(224,140,78,.06)' : 'transparent' }}>
                    {user ? (
                      <Avatar gradient={user.gradient} letter={user.name[0]} size={42} />
                    ) : (
                      <div style={{ width: 42, height: 42, borderRadius: 999, background: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                        <Icon name="bell" size={18} color="var(--color-accent-300)" />
                      </div>
                    )}
                    <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.45 }}>
                      {user && <span style={{ fontWeight: 700 }}>{user.id}</span>} {n.text}
                      {n.community && <span style={{ color: 'var(--color-accent-300)', fontWeight: 600 }}> {n.community}</span>}
                      <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.45)', marginTop: 2 }}>{n.time}</div>
                    </div>
                    {n.request ? (
                      <div style={{ display: 'flex', gap: 7, flex: 'none' }}>
                        <button type="button" onClick={() => respond(n.id)} className="pill-btn" style={{ padding: '7px 13px', background: 'var(--color-accent)', color: '#241305', fontSize: 12, fontWeight: 700 }}>
                          Accept
                        </button>
                        <button type="button" onClick={() => respond(n.id)} className="pill-btn" style={{ padding: '7px 12px', border: '1px solid var(--color-divider)', fontSize: 12, fontWeight: 700 }}>
                          Skip
                        </button>
                      </div>
                    ) : (
                      n.thumb && <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(140deg, var(--color-accent-700), var(--color-accent-2-800))', flex: 'none' }} />
                    )}
                  </div>
                );
              })}
          </div>
        ))}
        <div style={{ margin: '16px 20px 0', padding: 15, borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-divider)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Icon name="bell" size={22} color="var(--color-accent)" style={{ flex: 'none' }} />
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: 'rgba(242,230,212,.7)' }}>
            Notifications are per-{spaceSingular}. Mute a community without muting the rest.
          </div>
          <Link to="/c/grit-club/settings" style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-accent-300)', flex: 'none', textDecoration: 'none' }}>
            Set up
          </Link>
        </div>
      </div>
      <TabBar active="Home" />
    </div>
  );
}
