import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import TabBar from '../components/TabBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { COMMUNITIES } from '../data/mock';

const TILE_GRADIENTS = [
  ['var(--color-accent-600)', 'var(--color-accent-900)'],
  ['var(--color-neutral-700)', 'var(--color-neutral-900)'],
  ['var(--color-accent-2-600)', 'var(--color-accent-2-900)'],
  ['var(--color-accent-700)', 'var(--color-neutral-900)'],
];

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

export default function CreatePost() {
  const { communityId = 'grit-club' } = useParams();
  const navigate = useNavigate();
  const community = COMMUNITIES[communityId] || COMMUNITIES['grit-club'];
  const [caption, setCaption] = useState('');
  const [tile, setTile] = useState(0);
  const [allowComments, setAllowComments] = useState(true);
  const [shareStory, setShareStory] = useState(false);

  function handlePost(e) {
    e.preventDefault();
    navigate(`/c/${community.id}`);
  }

  return (
    <div style={{ '--color-accent': community.accent, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 18px 12px' }}>
        <button type="button" className="plain-btn" onClick={() => navigate(-1)} style={{ fontSize: 14, color: 'rgba(242,230,212,.6)' }}>
          Cancel
        </button>
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: 17 }}>New post</span>
        <button type="button" onClick={handlePost} className="pill-btn" style={{ padding: '7px 16px', background: 'var(--color-accent)', color: '#241305', fontSize: 13 }}>
          Post
        </button>
      </div>
      <div className="screen-scroll">
        <div style={{ height: 250, background: 'linear-gradient(150deg, var(--color-accent-700), #1b1713 55%, var(--color-accent-2-800))', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <Icon name="camera" size={50} color="rgba(242,230,212,.2)" strokeWidth={2} />
          <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', gap: 8 }}>
            <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,.5)', fontSize: 11.5, fontWeight: 700 }}>Crop</span>
            <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(0,0,0,.5)', fontSize: 11.5, fontWeight: 700 }}>Filter</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '4px 4px 0' }}>
          {TILE_GRADIENTS.map(([from, to], i) => (
            <button
              key={i}
              type="button"
              onClick={() => setTile(i)}
              className="plain-btn"
              style={{ flex: 1, height: 64, background: `linear-gradient(140deg, ${from}, ${to})`, border: tile === i ? '2px solid var(--color-accent)' : 'none', position: 'relative', cursor: 'pointer' }}
            >
              {tile === i && (
                <span style={{ position: 'absolute', right: 5, top: 5, width: 17, height: 17, borderRadius: 999, background: 'var(--color-accent)', color: '#241305', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {i + 1}
                </span>
              )}
            </button>
          ))}
          <div style={{ flex: 1, height: 64, background: 'rgba(242,230,212,.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="addPhoto" size={20} color="rgba(242,230,212,.5)" />
          </div>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <Avatar gradient="mara" letter="M" size={34} />
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Two spots left for Thursday, Kreuzberg carpool"
              aria-label="Caption"
              rows={2}
              style={{ flex: 1, fontSize: 14.5, lineHeight: 1.5, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', font: 'inherit', resize: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--color-divider)' }}>
              <Avatar gradient={community.gradient} letter={community.letter} shape="square" size={30} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Posting to {community.name}</span>
              <Icon name="chevronRight" size={17} color="rgba(242,230,212,.5)" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--color-divider)' }}>
              <Icon name="location" size={20} color="rgba(242,230,212,.65)" />
              <span style={{ flex: 1, fontSize: 14 }}>Add location</span>
              <Icon name="chevronRight" size={17} color="rgba(242,230,212,.5)" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--color-divider)' }}>
              <Icon name="comment" size={20} color="rgba(242,230,212,.65)" />
              <span style={{ flex: 1, fontSize: 14 }}>Allow comments</span>
              <Toggle on={allowComments} onClick={() => setAllowComments((v) => !v)} label="Allow comments" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: '1px solid var(--color-divider)', borderBottom: '1px solid var(--color-divider)' }}>
              <Icon name="clock" size={20} color="rgba(242,230,212,.65)" />
              <span style={{ flex: 1, fontSize: 14 }}>Also share as story</span>
              <Toggle on={shareStory} onClick={() => setShareStory((v) => !v)} label="Also share as story" />
            </div>
          </div>
        </div>
      </div>
      <TabBar active="Post" communityId={community.id} />
    </div>
  );
}
