import React from 'react';
import { useState } from 'react';
import { supabase } from './supabase.js';

export default function Landing() {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) return;

    setPhase('sending');
    setErrorMsg('');

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) throw error;
      setPhase('sent');
    } catch (err) {
      console.error('Auth error:', err);
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
      setPhase('error');
    }
  };

  return (
    <div
      style={{
        background: '#FFFFFF',
        minHeight: '100vh',
        fontFamily: "'DM Sans', -apple-system, sans-serif",
        color: '#37352F',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; }
        body { margin: 0; background: #FFFFFF; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes livepulse { 0%,100%{ opacity:1; } 50%{ opacity:0.3; } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .landing-input:focus { outline: none; border-color: #37352F; }
        .landing-btn:hover { opacity: 0.88; }
        .landing-btn:active { transform: scale(0.98); }
        .feature-card:hover { border-color: #BFBFBA; }
        a { color: #37352F; }
        a:hover { opacity: 0.7; }
      `}</style>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 20px' }}>
        {/* ── Top bar ── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '24px 0',
            borderBottom: '1px solid #F1F1EF',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: '-0.02em',
              }}
            >
              ₿
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#37352F' }}>
              MMAR Dashboard
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#27AE60',
                animation: 'livepulse 2s ease-in-out infinite',
              }}
            />
            <span style={{ fontSize: 11, color: '#9B9A97' }}>Live</span>
          </div>
        </div>

        {/* ── Hero ── */}
        <div
          style={{ padding: '80px 0 48px', animation: 'fadeUp 0.6s ease-out' }}
        >
          <h1
            style={{
              fontSize: 44,
              fontWeight: 800,
              letterSpacing: '-0.035em',
              lineHeight: 1.1,
              color: '#37352F',
              marginBottom: 20,
            }}
          >
            Should I buy
            <br />
            Bitcoin today?
          </h1>
          <p
            style={{
              fontSize: 17,
              color: '#6B6B6B',
              lineHeight: 1.65,
              maxWidth: 480,
            }}
          >
            A quantitative answer. Not opinions, not charts, not vibes — just a
            Power Law model, Mandelbrot's fractal math, and 500 simulated
            futures telling you if the price is cheap, fair, or expensive right
            now.
          </p>
        </div>

        {/* ── Email gate ── */}
        {phase === 'sent' ? (
          <div
            style={{
              padding: '40px 32px',
              background: '#F6FEF6',
              border: '1px solid #C8E6C9',
              borderRadius: 10,
              textAlign: 'center',
              animation: 'fadeUp 0.4s ease-out',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>✉️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              Check your email
            </h2>
            <p style={{ fontSize: 14, color: '#6B6B6B', lineHeight: 1.6 }}>
              We sent a magic link to{' '}
              <strong style={{ color: '#37352F' }}>{email}</strong>.<br />
              Click the link to access the dashboard. No password needed.
            </p>
            <p style={{ fontSize: 12, color: '#BFBFBA', marginTop: 16 }}>
              Didn't get it? Check spam, or{' '}
              <button
                onClick={() => {
                  setPhase('idle');
                  setEmail('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9B9A97',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                try again
              </button>
              .
            </p>
          </div>
        ) : (
          <div style={{ animation: 'fadeUp 0.6s ease-out 0.15s both' }}>
            <div
              style={{
                padding: '28px 28px 32px',
                background: '#FAFAF8',
                border: '1px solid #E8E5E0',
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#9B9A97',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 14,
                }}
              >
                Free access — just your email
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  className="landing-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e)}
                  placeholder="you@email.com"
                  disabled={phase === 'sending'}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    fontSize: 15,
                    border: '1px solid #E8E5E0',
                    borderRadius: 6,
                    background: '#FFF',
                    color: '#37352F',
                    fontFamily: "'DM Sans', sans-serif",
                    transition: 'border-color 0.15s',
                  }}
                />
                <button
                  className="landing-btn"
                  onClick={handleSubmit}
                  disabled={phase === 'sending' || !email.includes('@')}
                  style={{
                    padding: '12px 24px',
                    fontSize: 14,
                    fontWeight: 600,
                    background: '#37352F',
                    color: '#FFF',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif",
                    opacity:
                      phase === 'sending' || !email.includes('@') ? 0.5 : 1,
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {phase === 'sending' ? 'Sending...' : 'Get access →'}
                </button>
              </div>
              {phase === 'error' && (
                <p style={{ fontSize: 12, color: '#EB5757', marginTop: 10 }}>
                  {errorMsg}
                </p>
              )}
              <p style={{ fontSize: 11, color: '#BFBFBA', marginTop: 12 }}>
                We'll send you a magic link. No password, no spam, no
                newsletters. Just access.
              </p>
            </div>
          </div>
        )}

        {/* ── What you get ── */}
        <div
          style={{
            padding: '56px 0 40px',
            animation: 'fadeUp 0.6s ease-out 0.3s both',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#BFBFBA',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 20,
            }}
          >
            What's inside
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              {
                icon: '📐',
                title: 'Power Law fair value',
                desc: 'Is Bitcoin cheap or expensive right now? Measured against 15 years of structural growth data using Weighted Least Squares regression.',
              },
              {
                icon: '🎲',
                title: '500 simulated futures',
                desc: "Monte Carlo paths built with Mandelbrot's fractal model — not smooth Gaussian curves, but realistic crashes, rallies, and volatility clustering.",
              },
              {
                icon: '🛡️',
                title: 'Loss probability by horizon',
                desc: "If you buy today, what's your chance of being at a loss in 1 month, 3 months, 1 year, 3 years? Counted directly from simulated paths.",
              },
              {
                icon: '💬',
                title: 'YES / NO / CAUTIOUSLY',
                desc: 'A composite score from 7 independent signals — valuation, risk-reward, loss probability, 30-day outlook, market regime, temperature, and trend persistence.',
              },
            ].map(({ icon, title, desc }) => (
              <div
                key={title}
                className="feature-card"
                style={{
                  display: 'flex',
                  gap: 14,
                  padding: '16px 18px',
                  border: '1px solid #F1F1EF',
                  borderRadius: 8,
                  transition: 'border-color 0.2s',
                }}
              >
                <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#37352F',
                      marginBottom: 4,
                    }}
                  >
                    {title}
                  </div>
                  <div
                    style={{ fontSize: 13, color: '#9B9A97', lineHeight: 1.55 }}
                  >
                    {desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Teaser numbers ── */}
        <div
          style={{
            padding: '24px 28px',
            background: '#FAFAF8',
            border: '1px solid #E8E5E0',
            borderRadius: 10,
            marginBottom: 48,
            animation: 'fadeUp 0.6s ease-out 0.45s both',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#BFBFBA',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: 16,
            }}
          >
            Model specs
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
              textAlign: 'center',
            }}
          >
            {[
              { value: '4,500+', label: 'daily data points' },
              { value: '1,000', label: 'MC simulations' },
              { value: '7', label: 'weighted signals' },
            ].map(({ value, label }) => (
              <div key={label}>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    fontFamily: "'DM Mono', monospace",
                    color: '#37352F',
                  }}
                >
                  {value}
                </div>
                <div style={{ fontSize: 11, color: '#9B9A97', marginTop: 4 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Methodology one-liner ── */}
        <div
          style={{
            borderTop: '1px solid #F1F1EF',
            padding: '20px 0',
            marginBottom: 20,
            animation: 'fadeUp 0.6s ease-out 0.55s both',
          }}
        >
          <p
            style={{
              fontSize: 12,
              color: '#BFBFBA',
              lineHeight: 1.6,
              textAlign: 'center',
            }}
          >
            Santostasi Power Law (WLS) · Mandelbrot MMAR (DFA) ·
            Regime-Switching Ornstein-Uhlenbeck · Empirical Monte Carlo
          </p>
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            borderTop: '1px solid #F1F1EF',
            padding: '20px 0 40px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, color: '#BFBFBA' }}>
            Built by{' '}
            <a
              href="https://www.commonsense.finance/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontWeight: 600,
                textDecoration: 'none',
                color: '#9B9A97',
              }}
            >
              CommonSense
            </a>
            {' & '}
            <a
              href="https://www.linkedin.com/in/eduforte/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontWeight: 600,
                textDecoration: 'none',
                color: '#9B9A97',
              }}
            >
              Edu Forte
            </a>
          </span>
          <span style={{ fontSize: 11, color: '#E8E5E0' }}>
            Not financial advice
          </span>
        </div>
      </div>
    </div>
  );
}
