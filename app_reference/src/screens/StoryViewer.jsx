import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { COMMUNITIES, USERS, STORIES } from '../data/mock';

export default function StoryViewer() {
  const { communityId = 'grit-club' } = useParams();
  const navigate = useNavigate();
  const community = COMMUNITIES[communityId] || COMMUNITIES['grit-club'];
  const [index, setIndex] = useState(0);
  const [reply, setReply] = useState('');
  const [liked, setLiked] = useState(false);
  const story = STORIES[index];
  const author = USERS[story.user];

  function goHome() {
    navigate(`/c/${community.id}`);
  }
  function prev() {
    if (index > 0) setIndex((i) => i - 1);
    else goHome();
  }
  function next() {
    if (index < STORIES.length - 1) setIndex((i) => i + 1);
    else goHome();
  }
  function sendReply(e) {
    e.preventDefault();
    setReply('');
  }

  return (
    <div style={{ '--color-accent': community.accent, width: '100%', height: '100%', background: '#0c0a08', borderRadius: 'inherit', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(165deg, var(--color-accent-700), #0c0a08 48%, var(--color-accent-2-800))' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="camera" size={60} color="rgba(242,230,212,.16)" strokeWidth={2} />
      </div>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 180, background: 'linear-gradient(180deg, rgba(0,0,0,.65), transparent)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 220, background: 'linear-gradient(0deg, rgba(0,0,0,.75), transparent)' }} />

      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 4, padding: '12px 14px 0' }}>
          {STORIES.map((s, i) => (
            <div key={s.user} style={{ flex: 1, height: 3, borderRadius: 999, background: 'rgba(242,230,212,.28)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  borderRadius: 999,
                  background: 'rgba(242,230,212,.95)',
                  width: i < index ? '100%' : i === index ? '55%' : '0%',
                  transition: 'width .2s ease',
                }}
              />
            </div>
          ))}
        </div>
        <StatusBar />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}>
          <Avatar gradient={author.gradient} letter={author.name[0]} size={36} style={{ border: '1.5px solid rgba(242,230,212,.5)', borderRadius: 999 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{author.id}</div>
            <div style={{ fontSize: 11, color: 'rgba(242,230,212,.6)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {community.name}
              <span style={{ width: 3, height: 3, borderRadius: 999, background: 'rgba(242,230,212,.5)' }} />
              2h
            </div>
          </div>
          <Icon name="dotsH" size={19} color="rgba(242,230,212,.8)" />
          <button type="button" className="icon-btn" onClick={goHome} aria-label="Close story">
            <Icon name="close" size={21} color="rgba(242,230,212,.9)" />
          </button>
        </div>
      </div>

      <button type="button" onClick={prev} aria-label="Previous story" style={{ position: 'absolute', left: 0, top: 120, bottom: 120, width: '33%', background: 'transparent', border: 'none', cursor: 'pointer' }} />
      <button type="button" onClick={next} aria-label="Next story" style={{ position: 'absolute', right: 0, top: 120, bottom: 120, width: '67%', background: 'transparent', border: 'none', cursor: 'pointer' }} />

      <div style={{ flex: 1 }} />
      <div style={{ position: 'relative', padding: '0 18px 12px' }}>
        <div style={{ display: 'inline-block', padding: '8px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(0,0,0,.42)', backdropFilter: 'blur(6px)', fontSize: 14.5, lineHeight: 1.4, maxWidth: 270 }}>
          {story.caption}
        </div>
      </div>
      <form onSubmit={sendReply} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px 34px' }}>
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={`Reply to ${author.id}…`}
          aria-label="Reply"
          style={{ flex: 1, height: 46, borderRadius: 999, border: '1.5px solid rgba(242,230,212,.35)', background: 'transparent', padding: '0 18px', fontSize: 13.5, color: 'var(--color-text)', outline: 'none' }}
        />
        <button type="button" className="icon-btn" onClick={() => setLiked((v) => !v)} aria-label="Like story">
          <Icon name="heart" size={25} filled={liked} color={liked ? 'var(--color-accent)' : 'rgba(242,230,212,.9)'} strokeWidth={2.75} />
        </button>
        <button type="submit" className="icon-btn" aria-label="Send reply">
          <Icon name="send" size={25} color="rgba(242,230,212,.9)" />
        </button>
      </form>
    </div>
  );
}
