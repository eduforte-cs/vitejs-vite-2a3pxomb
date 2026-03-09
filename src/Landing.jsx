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
              Bitcoin Signal
            </span>
            <span style={{ fontSize: 10, color: '#BFBFBA', fontWeight: 400 }}>
              by CommonSense
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
            A clear answer based on math, not opinions. We analyze 15 years of
            Bitcoin data and run 500 simulations to tell you if the price is
            cheap, fair, or expensive right now — and what your actual risk is.
          </p>
          <p style={{ fontSize: 13, color: '#BFBFBA', marginTop: 14 }}>
            Built by{' '}
            <a
              href="https://www.commonsense.finance/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#9B9A97',
                fontWeight: 600,
                textDecoration: 'none',
                borderBottom: '1px dotted #BFBFBA',
              }}
            >
              CommonSense
            </a>{' '}
            &{' '}
            <a
              href="https://www.linkedin.com/in/eduforte/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#9B9A97',
                fontWeight: 600,
                textDecoration: 'none',
                borderBottom: '1px dotted #BFBFBA',
              }}
            >
              Edu Forte
            </a>
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
                  fontFamily: "'DM Sans', sans-serif",
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

        {/* ── What you'll see (plain language) ── */}
        <div
          style={{
            padding: '56px 0 0',
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
            What you'll see
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              {
                icon: '💬',
                title: 'A straight answer: YES, NO, or WAIT',
                desc: 'No ambiguity. The dashboard weighs 7 different signals and gives you one clear recommendation. Expand it to see exactly why.',
              },
              {
                icon: '🛡️',
                title: 'Your actual risk of losing money',
                desc: "If you buy today, what are your chances of being down in 1 month? 6 months? 1 year? 3 years? Not a guess — calculated from 500 simulated scenarios.",
              },
              {
                icon: '🌡️',
                title: 'Is Bitcoin cheap or expensive right now?',
                desc: "A live gauge that shows where the current price sits relative to Bitcoin's long-term growth trend. Think of it as a thermometer: blue means undervalued, red means overheated.",
              },
              {
                icon: '📖',
                title: 'A plain-language explanation',
                desc: 'Every number comes with a narrative that explains what it means in normal words. No jargon, no charts you need a PhD to read.',
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

        {/* ── Under the hood (for quants) ── */}
        <div
          style={{
            padding: '40px 0 40px',
            animation: 'fadeUp 0.6s ease-out 0.4s both',
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
            Under the hood
          </div>
          <div
            style={{
              padding: '20px 22px',
              background: '#FAFAF8',
              border: '1px solid #E8E5E0',
              borderRadius: 10,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                {
                  label: 'Power Law regression',
                  detail:
                    'Weighted Least Squares on 15 years of daily data (4,500+ points). Same foundational model as Santostasi and Burger, with WLS for better handling of early illiquid data.',
                },
                {
                  label: 'Fractal volatility',
                  detail:
                    "Mandelbrot's MMAR with Hurst exponent via DFA and multifractal partition function. Captures the fat tails and volatility clustering that Gaussian models miss entirely.",
                },
                {
                  label: 'Regime-switching mean-reversion',
                  detail:
                    'Ornstein-Uhlenbeck process with two regimes (calm and volatile), each with its own reversion speed and volatility scale. Markov transitions between regimes.',
                },
                {
                  label: 'Monte Carlo simulation',
                  detail:
                    "500 paths × 2 horizons (1Y and 3Y). Fractal cascades, empirical shock resampling, Hurst-correlated noise, regime-switching OU anchoring. Every shock actually occurred in Bitcoin's real history.",
                },
              ].map(({ label, detail }) => (
                <div key={label}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#37352F',
                      marginBottom: 3,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{ fontSize: 12, color: '#9B9A97', lineHeight: 1.55 }}
                  >
                    {detail}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 16,
                textAlign: 'center',
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid #E8E5E0',
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
                  <div
                    style={{ fontSize: 11, color: '#9B9A97', marginTop: 4 }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
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
            <span style={{ color: '#E8E5E0' }}> · Barcelona</span>
          </span>
          <span style={{ fontSize: 11, color: '#E8E5E0' }}>
            Not financial advice
          </span>
        </div>
      </div>
    </div>
  );
}
