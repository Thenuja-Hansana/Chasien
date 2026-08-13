import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { COMMUNITIES, POSTS, USERS } from '../data/mock';

export default function PostDetail() {
  const { communityId = 'grit-club', postId } = useParams();
  const navigate = useNavigate();
  const community = COMMUNITIES[communityId] || COMMUNITIES['grit-club'];
  const post = POSTS.find((p) => p.id === postId) || POSTS[0];
  const author = USERS[post.author];
  const [comments, setComments] = useState(post.comments || []);
  const [draft, setDraft] = useState('');
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes || 0);
  const [saved, setSaved] = useState(false);

  function submitComment(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setComments((c) => [...c, { id: Date.now(), author: 'mara', text: draft.trim(), time: 'just now' }]);
    setDraft('');
  }

  return (
    <div style={{ '--color-accent': community.accent, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StatusBar />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 18px 12px', borderBottom: '1px solid var(--color-divider)' }}>
        <button type="button" className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Post</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-accent-300)' }}>{community.name}</div>
        </div>
        <Icon name="dotsH" size={20} color="rgba(242,230,212,.6)" />
      </div>
      <div className="screen-scroll">
        {post.hasImage && (
          <div style={{ height: 330, background: 'linear-gradient(150deg, var(--color-accent-700), #1b1713 55%, var(--color-accent-2-800))', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <Icon name="camera" size={52} color="rgba(242,230,212,.2)" strokeWidth={2} />
            <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 5 }}>
              {Array.from({ length: post.imageCount || 1 }).map((_, i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: i === 0 ? 'var(--color-accent)' : 'rgba(242,230,212,.3)' }} />
              ))}
            </div>
          </div>
        )}
        <div style={{ padding: '14px 18px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 12 }}>
            <button type="button" className="plain-btn" onClick={() => { setLiked((v) => !v); setLikeCount((c) => c + (liked ? -1 : 1)); }} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700 }}>
              <Icon name="heart" size={23} filled={liked} color={liked ? 'var(--color-accent)' : 'var(--color-text)'} />
              {likeCount}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700 }}>
              <Icon name="comment" size={23} />
              {comments.length}
            </div>
            <div style={{ flex: 1 }} />
            <button type="button" className="icon-btn" onClick={() => setSaved((v) => !v)}>
              <Icon name="bookmark" size={22} filled={saved} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <Avatar gradient={author.gradient} letter={author.name[0]} size={34} />
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700 }}>{author.id}</span> {post.text}{' '}
              {post.tag && <span style={{ color: 'var(--color-accent-300)' }}>{post.tag}</span>}
              <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.45)', marginTop: 5 }}>{post.time}</div>
            </div>
          </div>
          <div style={{ height: 1, background: 'var(--color-divider)', marginBottom: 14 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 15, paddingBottom: 20 }}>
            {comments.map((c) => {
              const u = USERS[c.author] || USERS.mara;
              return (
                <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', paddingLeft: c.reply ? 42 : 0 }}>
                  <Avatar gradient={u.gradient} letter={u.name[0]} size={c.reply ? 28 : 32} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 700 }}>{u.id}</span> {c.text}
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'rgba(242,230,212,.45)', marginTop: 5 }}>
                      <span>{c.time}</span>
                      <span style={{ fontWeight: 700 }}>Reply</span>
                      {c.likes && <span>{c.likes} likes</span>}
                    </div>
                  </div>
                  {!c.reply && <Icon name="heart" size={15} color="rgba(242,230,212,.45)" style={{ marginTop: 3 }} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <form onSubmit={submitComment} style={{ padding: '11px 16px 30px', borderTop: '1px solid var(--color-divider)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--color-surface)' }}>
        <Avatar gradient="mara" letter="M" size={34} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          style={{ flex: 1, height: 42, borderRadius: 999, background: '#17130f', border: '1px solid var(--color-divider)', padding: '0 16px', fontSize: 13.5, color: 'var(--color-text)', outline: 'none' }}
        />
        <button type="submit" className="icon-btn" style={{ width: 42, height: 42, borderRadius: 999, background: 'var(--color-accent)', flex: 'none' }} aria-label="Send comment">
          <Icon name="send" size={19} color="#241305" />
        </button>
      </form>
    </div>
  );
}
