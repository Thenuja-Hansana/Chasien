import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { COMMUNITIES } from '../data/mock';

const THEME_COLORS = ['#e08c4e', '#a3b585', 'var(--color-neutral-400)', 'var(--color-accent-400)', 'var(--color-accent-2-600)'];

function Toggle({ on, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="toggle"
      role="switch"
      aria-checked={on}
      aria-label={label}
      style={{ background: on ? 'var(--color-accent)' : 'rgba(242,230,212,.14)', justifyContent: on ? 'flex-end' : 'flex-start' }}
    >
      <div className="toggle-thumb" style={{ background: on ? '#f6e7d2' : 'rgba(242,230,212,.55)' }} />
    </button>
  );
}

export default function CommunitySettings() {
  const { communityId = 'grit-club' } = useParams();
  const navigate = useNavigate();
  const community = COMMUNITIES[communityId] || COMMUNITIES['grit-club'];
  const [accent, setAccent] = useState(community.accent);
  const [description, setDescription] = useState(community.description);
  const [isPublic, setIsPublic] = useState(community.visibility === 'Public');
  const [membersCanPost, setMembersCanPost] = useState(true);

  return (
    <div style={{ '--color-accent': accent, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 18px 10px' }}>
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <span style={{ flex: 1, fontFamily: 'var(--font-heading)', fontSize: 19 }}>Customise</span>
        <button type="button" className="plain-btn" onClick={() => navigate(`/c/${community.id}`)} style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-accent-300)' }}>
          Save
        </button>
      </div>
      <div className="screen-scroll" style={{ padding: '0 18px' }}>
        <div style={{ position: 'relative', height: 116, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(140deg, var(--color-accent-600), var(--color-accent-900))', marginBottom: 34 }}>
          <div style={{ position: 'absolute', right: 10, top: 10, padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,.45)', fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="edit" size={13} />
            Banner
          </div>
          <div style={{ position: 'absolute', left: 16, bottom: -26 }}>
            <Avatar gradient={community.gradient} letter={community.letter} shape="square" size={62} style={{ border: '3px solid var(--color-bg)', borderRadius: 20 }} />
          </div>
        </div>
        <div style={labelStyle}>Theme colour</div>
        <div style={{ display: 'flex', gap: 11, marginBottom: 20 }}>
          {THEME_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setAccent(c)}
              aria-label={`Theme colour ${c}`}
              className="plain-btn"
              style={{
                width: 38,
                height: 38,
                borderRadius: 999,
                background: c,
                boxShadow: accent === c ? `0 0 0 2px var(--color-bg), 0 0 0 4px ${c}` : 'none',
                cursor: 'pointer',
              }}
            />
          ))}
          <button type="button" className="plain-btn" style={{ width: 38, height: 38, borderRadius: 999, border: '1px dashed rgba(242,230,212,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-label="Custom colour">
            <Icon name="plus" size={16} color="rgba(242,230,212,.55)" />
          </button>
        </div>
        <div style={labelStyle}>Description</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ width: '100%', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-divider)', padding: '12px 15px', fontSize: 14, lineHeight: 1.5, marginBottom: 20, color: 'var(--color-text)', font: 'inherit', resize: 'none' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--color-divider)' }}>
          <Icon name="lock" size={20} color="rgba(242,230,212,.65)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Public community</div>
            <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.45)' }}>Anyone can find and join</div>
          </div>
          <Toggle on={isPublic} onClick={() => setIsPublic((v) => !v)} label="Public community" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--color-divider)', borderBottom: '1px solid var(--color-divider)', marginBottom: 18 }}>
          <Icon name="plus" size={20} color="rgba(242,230,212,.65)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Members can post</div>
            <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.45)' }}>Off = only mods post</div>
          </div>
          <Toggle on={membersCanPost} onClick={() => setMembersCanPost((v) => !v)} label="Members can post" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={labelStyle}>Roles</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-accent-300)' }}>Manage</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Avatar gradient="mara" letter="M" size={36} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Mara Oyelaran</span>
            <span style={{ padding: '4px 11px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)', color: 'var(--color-accent-300)', fontSize: 11, fontWeight: 700 }}>Owner</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Avatar gradient="tobi" letter="T" size={36} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Tobi Andersen</span>
            <span style={{ padding: '4px 11px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-accent-2) 22%, transparent)', color: 'var(--color-accent-2-300)', fontSize: 11, fontWeight: 700 }}>Mod</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(242,230,212,.4)', marginBottom: 8 };
