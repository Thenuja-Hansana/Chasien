import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Icon from '../components/Icon';

export default function SignUp() {
  const navigate = useNavigate();
  const [handle, setHandle] = useState('maraclimbs');
  const [name, setName] = useState('Mara Oyelaran');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);

  const handleTaken = handle.trim().length === 0;
  const strength = Math.min(4, Math.max(1, Math.ceil(password.length / 3)));

  function handleSubmit(e) {
    e.preventDefault();
    if (!agree || handleTaken) return;
    navigate('/discover');
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '48px 22px 0' }}>
        <Link to="/login" className="icon-btn" aria-label="Back">
          <Icon name="back" size={22} />
        </Link>
        <div style={{ flex: 1, display: 'flex', gap: 5 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--color-accent)' }} />
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--color-accent)' }} />
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(242,230,212,.15)' }} />
        </div>
        <span style={{ fontSize: 12, color: 'rgba(242,230,212,.45)' }}>2 of 3</span>
      </div>
      <form onSubmit={handleSubmit} className="screen-scroll" style={{ flex: 1, padding: '34px 30px 0' }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 32, lineHeight: 1.08, marginBottom: 8 }}>
          Pick your
          <br />
          handle
        </div>
        <div style={{ fontSize: 14, color: 'rgba(242,230,212,.55)', marginBottom: 30, lineHeight: 1.5 }}>
          This is how people find you across every community.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={labelStyle}>Handle</div>
            <div style={{ ...fieldStyle, justifyContent: 'space-between' }}>
              <span>
                <span style={{ color: 'rgba(242,230,212,.4)' }}>@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.replace(/\s/g, ''))}
                  style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', outline: 'none', width: 160 }}
                  aria-label="Handle"
                />
              </span>
              {!handleTaken && <Icon name="check" size={18} color="var(--color-accent-2)" />}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-accent-2-300)', marginTop: 8, paddingLeft: 6 }}>
              {handleTaken ? 'Pick a handle' : 'Available'}
            </div>
          </div>
          <div>
            <div style={labelStyle}>Display name</div>
            <input className="input" style={fieldInputStyle} value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
          </div>
          <div>
            <div style={labelStyle}>Password</div>
            <input
              className="input"
              type="password"
              style={{ ...fieldInputStyle, letterSpacing: '.22em' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              aria-label="Password"
            />
            <div style={{ display: 'flex', gap: 5, marginTop: 10, padding: '0 6px' }}>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 3,
                    borderRadius: 999,
                    background: i < strength ? 'var(--color-accent-2)' : 'rgba(242,230,212,.15)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 26, cursor: 'pointer' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              background: agree ? 'var(--color-accent)' : 'transparent',
              border: agree ? 'none' : '1.5px solid var(--color-divider)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            {agree && <Icon name="check" size={13} color="#241305" strokeWidth={3.4} />}
          </div>
          <div style={{ fontSize: 12.5, color: 'rgba(242,230,212,.55)', lineHeight: 1.5 }}>
            I&apos;m 16 or older and accept the community guidelines.
          </div>
        </label>
      </form>
      <div style={{ padding: '0 30px 34px' }}>
        <button
          type="submit"
          onClick={handleSubmit}
          disabled={!agree || handleTaken}
          className="pill-btn"
          style={{
            width: '100%',
            height: 54,
            background: 'var(--color-accent)',
            color: '#241305',
            fontSize: 16,
            gap: 8,
            boxShadow: '0 8px 22px color-mix(in srgb, var(--color-accent) 28%, transparent)',
            opacity: !agree || handleTaken ? 0.5 : 1,
          }}
        >
          Continue
          <Icon name="chevronRight" size={18} color="#241305" />
        </button>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'rgba(242,230,212,.45)',
  marginBottom: 8,
};

const fieldStyle = {
  height: 52,
  borderRadius: 999,
  background: 'var(--color-surface)',
  border: '1.5px solid var(--color-accent)',
  display: 'flex',
  alignItems: 'center',
  padding: '0 20px',
  fontSize: 15,
};

const fieldInputStyle = { height: 52, fontSize: 15, borderRadius: 999 };
