import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import TabBar from '../components/TabBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { COMMUNITIES, POSTS, USERS, STORIES } from '../data/mock';

function PollCard({ poll }) {
  const [options, setOptions] = useState(poll.options);
  const [voted, setVoted] = useState(null);

  function vote(i) {
    if (voted !== null) return;
    setVoted(i);
    const next = options.map((o, idx) => (idx === i ? { ...o, votes: o.votes + 1 } : o));
    const total = next.reduce((s, o) => s + o.votes, 0);
    setOptions(next.map((o) => ({ ...o, pct: Math.round((o.votes / total) * 100) })));
  }

  return (
    <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', border: '1px solid var(--color-divider)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 9 }}>{poll.question}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {options.map((o, i) => (
          <button
            key={o.label}
            type="button"
            onClick={() => vote(i)}
            className="plain-btn"
            style={{ position: 'relative', height: 30, borderRadius: 999, background: 'rgba(242,230,212,.07)', overflow: 'hidden', cursor: voted === null ? 'pointer' : 'default', width: '100%' }}
          >
            <div style={{ position: 'absolute', inset: 0, width: `${o.pct}%`, background: i === voted ? 'color-mix(in srgb, var(--color-accent) 44%, transparent)' : 'color-mix(in srgb, var(--color-accent) 34%, transparent)', transition: 'width .2s ease' }} />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%', padding: '0 13px', fontSize: 12, fontWeight: 600 }}>
              <span>{o.label}</span>
              <span>{o.votes}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { communityId = 'grit-club' } = useParams();
  const navigate = useNavigate();
  const community = COMMUNITIES[communityId] || COMMUNITIES['grit-club'];
  const posts = useMemo(() => POSTS.filter((p) => p.communityId === community.id), [community.id]);
  const [likes, setLikes] = useState(() => Object.fromEntries(posts.map((p) => [p.id, { liked: false, count: p.likes || 0 }])));
  const [saved, setSaved] = useState({});

  function toggleLike(id) {
    setLikes((l) => {
      const cur = l[id] || { liked: false, count: 0 };
      return { ...l, [id]: { liked: !cur.liked, count: cur.count + (cur.liked ? -1 : 1) } };
    });
  }

  return (
    <div style={{ '--color-accent': community.accent, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 26%, #17130f), #17130f)' }}>
        <StatusBar />
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '2px 18px 12px' }}>
          <Avatar gradient={community.gradient} letter={community.letter} shape="square" size={38} />
          <Link to="/discover" className="link-reset" style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20, lineHeight: 1.1, display: 'flex', alignItems: 'center', gap: 6 }}>
              {community.name}
              <Icon name="chevronDown" size={14} color="rgba(242,230,212,.6)" strokeWidth={3} />
            </div>
            <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.6)' }}>
              {community.members.toLocaleString()} members · {community.online ?? 0} online
            </div>
          </Link>
          <Link to="/notifications" className="icon-btn" aria-label="Notifications">
            <Icon name="bell" size={20} />
          </Link>
          <Link to="/search" className="icon-btn" aria-label="Search">
            <Icon name="search" size={21} />
          </Link>
          <Link to={`/c/${community.id}/settings`} className="icon-btn" aria-label="Community settings">
            <Icon name="dotsV" size={21} />
          </Link>
        </div>
        <div style={{ display: 'flex', gap: 13, padding: '0 18px 14px', overflow: 'hidden' }}>
          <Link to={`/c/${community.id}/create-post`} className="link-reset" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 'none' }}>
            <div style={{ width: 60, height: 60, borderRadius: 999, border: '1.5px dashed color-mix(in srgb, var(--color-accent) 60%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(242,230,212,.04)' }}>
              <Icon name="plus" size={22} color="var(--color-accent)" />
            </div>
            <span style={{ fontSize: 10.5, color: 'rgba(242,230,212,.55)' }}>Your story</span>
          </Link>
          {STORIES.map((s) => {
            const u = USERS[s.user];
            return (
              <button key={s.user} type="button" onClick={() => navigate(`/c/${community.id}/story`)} className="plain-btn" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 'none' }}>
                <Avatar gradient={u.gradient} letter={u.name[0]} size={60} ring />
                <span style={{ fontSize: 10.5, color: 'rgba(242,230,212,.8)' }}>{u.id}</span>
              </button>
            );
          })}
          {['kwame', 'rui'].map((id) => {
            const u = USERS[id];
            return (
              <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 'none' }}>
                <div style={{ width: 60, height: 60, borderRadius: 999, padding: 2.5, background: 'rgba(242,230,212,.18)', boxSizing: 'border-box' }}>
                  <Avatar gradient={u.gradient} letter={u.name[0]} size={55} />
                </div>
                <span style={{ fontSize: 10.5, color: 'rgba(242,230,212,.5)' }}>{id}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="screen-scroll" style={{ background: 'var(--color-bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px 9px' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-accent-300)' }}>Newest first</span>
          <div style={{ flex: 1, height: 1, background: 'var(--color-divider)' }} />
        </div>
        {posts.map((post, i) => {
          const author = USERS[post.author];
          const like = likes[post.id] || { liked: false, count: post.likes || 0 };
          return (
            <div key={post.id} style={{ padding: '0 18px 14px', borderBottom: i < posts.length - 1 ? '1px solid var(--color-divider)' : 'none', paddingTop: i > 0 ? 14 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Avatar gradient={author.gradient} letter={author.name[0]} size={38} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {author.name}
                    {post.author === 'tobi' && community.id === 'grit-club' && (
                      <span style={{ padding: '2px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)', color: 'var(--color-accent-300)', fontSize: 9.5, fontWeight: 700 }}>MOD</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.5)' }}>{post.time}</div>
                </div>
                <Icon name="dotsH" size={18} color="rgba(242,230,212,.5)" />
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: post.hasImage || post.poll ? 10 : 0 }}>
                {post.text} {post.tag && <span style={{ color: 'var(--color-accent-300)' }}>{post.tag}</span>}
              </div>
              {post.hasImage && (
                <button
                  type="button"
                  onClick={() => navigate(`/c/${community.id}/post/${post.id}`)}
                  className="plain-btn"
                  style={{ width: '100%', borderRadius: 'var(--radius-md)', overflow: 'hidden', height: 230, background: 'linear-gradient(150deg, var(--color-accent-700), #1b1713 55%, var(--color-accent-2-800))', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', cursor: 'pointer' }}
                >
                  <Icon name="camera" size={46} color="rgba(242,230,212,.22)" strokeWidth={2} />
                  {post.imageCount > 1 && (
                    <div style={{ position: 'absolute', right: 10, top: 10, padding: '3px 9px', borderRadius: 999, background: 'rgba(0,0,0,.5)', fontSize: 10.5, fontWeight: 700 }}>1/{post.imageCount}</div>
                  )}
                </button>
              )}
              {post.poll && <PollCard poll={post.poll} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 11 }}>
                <button type="button" onClick={() => toggleLike(post.id)} className="plain-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
                  <Icon name="heart" size={21} filled={like.liked} color={like.liked ? 'var(--color-accent)' : 'var(--color-text)'} />
                  {like.count}
                </button>
                <Link to={`/c/${community.id}/post/${post.id}`} className="link-reset" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700 }}>
                  <Icon name="comment" size={21} />
                  {post.comments?.length || 0}
                </Link>
                <div style={{ flex: 1 }} />
                <button type="button" onClick={() => setSaved((s) => ({ ...s, [post.id]: !s[post.id] }))} className="icon-btn">
                  <Icon name="bookmark" size={21} filled={saved[post.id]} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <TabBar active="Home" communityId={community.id} />
    </div>
  );
}
