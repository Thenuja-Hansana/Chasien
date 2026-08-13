import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import StatusBar from '../components/StatusBar';
import Icon from '../components/Icon';
import { spaceLower } from '../data/mock';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('mara@oyelaran.co');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    navigate('/discover');
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <StatusBar />
      <div
        style={{
          position: 'absolute',
          top: -90,
          right: -70,
          width: 280,
          height: 280,
          borderRadius: 999,
          background: 'radial-gradient(circle at 40% 40%, color-mix(in srgb, var(--color-accent) 34%, transparent), transparent 70%)',
        }}
      />
      <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 30px', position: 'relative' }}>
        <svg width="46" height="46" viewBox="0 0 34 34" fill="none" style={{ marginBottom: 18 }}>
          <circle cx="13" cy="17" r="9" stroke="var(--color-accent)" strokeWidth="2.75" />
          <circle cx="21" cy="17" r="9" stroke="var(--color-accent-2)" strokeWidth="2.75" />
        </svg>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 38, letterSpacing: '-.025em', lineHeight: 1.05, marginBottom: 10 }}>chasien</div>
        <div style={{ fontSize: 15, color: 'rgba(242,230,212,.6)', lineHeight: 1.5, marginBottom: 34, maxWidth: 280 }}>
          Small {spaceLower}, in order. Everything newest-first, nothing ranked.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          <input
            className="input"
            style={{ height: 52, fontSize: 15, borderRadius: 999 }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email or handle"
            aria-label="Email or handle"
          />
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type={showPassword ? 'text' : 'password'}
              style={{ height: 52, fontSize: 15, borderRadius: 999, borderColor: 'var(--color-accent)', borderWidth: 1.5, paddingRight: 44 }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowPassword((v) => !v)}
              style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)' }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon name="eye" size={19} color="rgba(242,230,212,.5)" />
            </button>
          </div>
        </div>
        <button
          type="submit"
          className="pill-btn"
          style={{
            height: 54,
            background: 'var(--color-accent)',
            color: '#241305',
            fontSize: 16,
            boxShadow: '0 8px 22px color-mix(in srgb, var(--color-accent) 28%, transparent)',
          }}
        >
          Log in
        </button>
        <div style={{ textAlign: 'center', fontSize: 13, color: 'rgba(242,230,212,.5)', marginTop: 16 }}>Forgot password?</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '28px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--color-divider)' }} />
          <span style={{ fontSize: 11, color: 'rgba(242,230,212,.4)' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--color-divider)' }} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="pill-btn" style={{ flex: 1, height: 50, border: '1px solid var(--color-divider)', gap: 8, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)' }}>
            <Icon name="apple" size={17} />
            Apple
          </button>
          <button type="button" className="pill-btn" style={{ flex: 1, height: 50, border: '1px solid var(--color-divider)', gap: 8, fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)' }}>
            <Icon name="google" size={17} />
            Google
          </button>
        </div>
      </form>
      <div style={{ padding: '0 30px 34px', textAlign: 'center', fontSize: 14, color: 'rgba(242,230,212,.55)' }}>
        New here?{' '}
        <Link to="/signup" style={{ color: 'var(--color-accent-300)', fontWeight: 700, textDecoration: 'none' }}>
          Create an account
        </Link>
      </div>
    </div>
  );
}
