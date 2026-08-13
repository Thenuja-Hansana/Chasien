import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { CHATS, CHAT_MESSAGES, USERS, COMMUNITIES } from '../data/mock';

export default function ChatView() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const chat = CHATS.find((c) => c.id === chatId) || CHATS[2];
  const community = chat.kind === 'community' ? COMMUNITIES[chat.communityId] : null;
  const dmUser = chat.kind === 'dm' ? USERS[chat.user] : null;
  const [messages, setMessages] = useState(CHAT_MESSAGES[chat.id] || [{ id: 1, author: chat.lastSender || dmUser?.id, text: chat.last, time: chat.time }]);
  const [draft, setDraft] = useState('');
  const accent = community?.accent || '#e08c4e';

  function send(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setMessages((m) => [...m, { id: Date.now(), author: 'mara', text: draft.trim(), time: 'now', mine: true }]);
    setDraft('');
  }

  return (
    <div style={{ '--color-accent': accent, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 22%, #17130f), #17130f)', borderBottom: '1px solid var(--color-divider)' }}>
        <StatusBar />
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '2px 16px 11px' }}>
          <button type="button" className="icon-btn" onClick={() => navigate('/chats')} aria-label="Back">
            <Icon name="back" size={22} />
          </button>
          <Avatar gradient={community ? community.gradient : dmUser.gradient} letter={community ? community.letter : dmUser.name[0]} shape={community ? 'square' : 'circle'} size={38} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{community ? chat.title.split(' · ')[1] || chat.title : dmUser.name}</div>
            <div style={{ fontSize: 11.5, color: 'rgba(242,230,212,.55)' }}>
              {community ? `${community.name} · ${community.members.toLocaleString()} members` : dmUser.handle}
            </div>
          </div>
          <Icon name="search" size={20} />
          <Icon name="dotsV" size={20} />
        </div>
      </div>
      <div className="screen-scroll" style={{ padding: '14px 14px 0', display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div style={{ alignSelf: 'center', padding: '4px 12px', borderRadius: 999, background: 'rgba(242,230,212,.07)', fontSize: 11, color: 'rgba(242,230,212,.5)' }}>Today</div>
        {messages.map((m) => {
          if (m.mine) {
            return (
              <div key={m.id} style={{ alignSelf: 'flex-end', maxWidth: 255 }}>
                <div style={{ background: 'var(--color-accent)', color: '#1d2415', borderRadius: '18px 18px 6px 18px', padding: '9px 13px', fontSize: 14.5, lineHeight: 1.45 }}>{m.text}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'rgba(242,230,212,.4)', marginTop: 4, paddingRight: 4 }}>
                  {m.time}
                  {m.read && <Icon name="checkDouble" size={15} color="var(--color-accent-2-300)" strokeWidth={2.4} />}
                </div>
              </div>
            );
          }
          const u = USERS[m.author] || { gradient: 'mara', name: m.author || '?' };
          return (
            <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Avatar gradient={u.gradient} letter={(u.name || '?')[0]} size={28} />
              <div style={{ maxWidth: 250 }}>
                {m.image ? (
                  <div style={{ background: 'var(--color-surface)', borderRadius: 18, padding: 5, width: 200 }}>
                    <div style={{ height: 150, borderRadius: 14, background: 'linear-gradient(150deg, var(--color-accent-2-700), #1b1713 60%, var(--color-neutral-700))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="camera" size={34} color="rgba(242,230,212,.22)" strokeWidth={2} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 10.5, color: 'rgba(242,230,212,.4)', padding: '5px 7px 3px' }}>{m.time}</div>
                  </div>
                ) : (
                  <div style={{ background: 'var(--color-surface)', borderRadius: '18px 18px 18px 6px', padding: '9px 13px', fontSize: 14.5, lineHeight: 1.45 }}>
                    {m.text}
                    <span style={{ float: 'right', fontSize: 10.5, color: 'rgba(242,230,212,.4)', margin: '6px 0 0 10px' }}>{m.time}</span>
                  </div>
                )}
                {m.reaction && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '6px 0 0 10px', padding: '3px 9px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-accent) 20%, transparent)', fontSize: 11.5, fontWeight: 700 }}>
                    {m.reaction}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div style={{ height: 8 }} />
      </div>
      <form onSubmit={send} style={{ padding: '10px 14px 30px', display: 'flex', alignItems: 'flex-end', gap: 9, background: 'var(--color-surface)', borderTop: '1px solid var(--color-divider)' }}>
        <div className="icon-btn" style={{ marginBottom: 9 }}>
          <Icon name="attach" size={24} color="rgba(242,230,212,.6)" />
        </div>
        <div style={{ flex: 1, minHeight: 42, borderRadius: 21, background: '#17130f', border: '1px solid var(--color-divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 15px' }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message"
            aria-label="Message"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', font: 'inherit', fontSize: 14 }}
          />
          <Icon name="emoji" size={19} color="rgba(242,230,212,.5)" />
        </div>
        <button type="submit" className="icon-btn" style={{ width: 42, height: 42, borderRadius: 999, background: 'var(--color-accent)', flex: 'none' }} aria-label="Send">
          <Icon name={draft.trim() ? 'send' : 'mic'} size={draft.trim() ? 19 : 20} color="#1d2415" />
        </button>
      </form>
    </div>
  );
}
