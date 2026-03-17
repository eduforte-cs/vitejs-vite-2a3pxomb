import React from 'react';
import { useState } from 'react';
import { supabase } from './supabase.js';

export default function Landing() {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) return;
    setPhase('sending');
    setErrorMsg('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
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
    <div style={{
      background: '#FFFFFF',
      minHeight: '100vh',
      fontFamily: "'DM Sans', -apple-system, sans-serif",
      color: '#37352F',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; }
        body { margin: 0; background: #FFFFFF; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes livepulse { 0%,100%{ opacity:1; } 50%{ opacity:0.3; } }
        .landing-input:focus { outline: none; border-color: #37352F; }
        .landing-btn:hover { opacity: 0.88; }
        .landing-btn:active { transform: scale(0.98); }
        .feature-card:hover { border-color: #BFBFBA; background: #FAFAF8; }
        a { color: #37352F; text-decoration: none; }
        a:hover { opacity: 0.7; }
      `}</style>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 20px' }}>

        {/* ── Top bar ── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '22px 0', borderBottom: '1px solid #F1F1EF',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>₿</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#37352F' }}>Bitcoin Signal</span>
            <span style={{ fontSize: 10, color: '#BFBFBA', fontWeight: 400 }}>by CommonSense</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: '#27AE60', animation: 'livepulse 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 11, color: '#9B9A97' }}>Live data</span>
          </div>
        </div>

        {/* ── Hero ── */}
        <div style={{ padding: '72px 0 40px', animation: 'fadeUp 0.6s ease-out' }}>
          <h1 style={{
            fontSize: 46, fontWeight: 800, letterSpacing: '-0.035em',
            lineHeight: 1.08, color: '#37352F', marginBottom: 18,
          }}>
            Should I buy<br />Bitcoin today?
          </h1>
          <p style={{ fontSize: 17, color: '#6B6B6B', lineHeight: 1.65, maxWidth: 480 }}>
            An honest opinion based on quantitative analysis — 16 years of data,
            fractal mathematics, and 2,000 Monte Carlo simulations — translated
            into plain language so you can actually act on it.
          </p>
          <p style={{ fontSize: 13, color: '#BFBFBA', marginTop: 14 }}>
            Built by{' '}
            <a href="https://www.commonsense.finance/" target="_blank" rel="noopener noreferrer"
              style={{ color: '#9B9A97', fontWeight: 600, borderBottom: '1px dotted #BFBFBA' }}>
              CommonSense
            </a>{' '}&{' '}
            <a href="https://www.linkedin.com/in/eduforte/" target="_blank" rel="noopener noreferrer"
              style={{ color: '#9B9A97', fontWeight: 600, borderBottom: '1px dotted #BFBFBA' }}>
              Edu Forte
            </a>
          </p>
        </div>

        {/* ── Email gate ── */}
        {phase === 'sent' ? (
          <div style={{
            padding: '40px 32px', background: '#F6FEF6',
            border: '1px solid #C8E6C9', borderRadius: 10,
            textAlign: 'center', animation: 'fadeUp 0.4s ease-out',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✉️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Check your email</h2>
            <p style={{ fontSize: 14, color: '#6B6B6B', lineHeight: 1.6 }}>
              We sent a magic link to <strong style={{ color: '#37352F' }}>{email}</strong>.<br />
              Click it to access the dashboard. No password needed.
            </p>
            <p style={{ fontSize: 12, color: '#BFBFBA', marginTop: 16 }}>
              Didn't get it? Check spam, or{' '}
              <button onClick={() => { setPhase('idle'); setEmail(''); }}
                style={{
                  background: 'none', border: 'none', color: '#9B9A97',
                  textDecoration: 'underline', cursor: 'pointer',
                  fontSize: 12, fontFamily: "'DM Sans', sans-serif",
                }}>
                try again
              </button>.
            </p>
          </div>
        ) : (
          <div style={{ animation: 'fadeUp 0.6s ease-out 0.15s both' }}>
            <div style={{
              padding: '28px 28px 32px', background: '#FAFAF8',
              border: '1px solid #E8E5E0', borderRadius: 10,
            }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: '#9B9A97',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14,
              }}>
                Free access — just your email
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  className="landing-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e)}
                  placeholder="you@email.com"
                  disabled={phase === 'sending'}
                  style={{
                    width: '100%', padding: '12px 16px', fontSize: 15,
                    border: '1px solid #E8E5E0', borderRadius: 6,
                    background: '#FFF', color: '#37352F',
                    fontFamily: "'DM Sans', sans-serif",
                    transition: 'border-color 0.15s',
                  }}
                />
                <button
                  className="landing-btn"
                  onClick={handleSubmit}
                  disabled={phase === 'sending' || !email.includes('@')}
                  style={{
                    width: '100%', padding: '13px 24px', fontSize: 15, fontWeight: 600,
                    background: '#37352F', color: '#FFF', border: 'none',
                    borderRadius: 6, cursor: 'pointer',
                    fontFamily: "'DM Sans', sans-serif",
                    opacity: phase === 'sending' || !email.includes('@') ? 0.5 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {phase === 'sending' ? 'Sending...' : 'Get access →'}
                </button>
              </div>
              {phase === 'error' && (
                <p style={{ fontSize: 12, color: '#EB5757', marginTop: 10 }}>{errorMsg}</p>
              )}
              <p style={{ fontSize: 11, color: '#BFBFBA', marginTop: 12 }}>
                Magic link. No password, no spam, no newsletters. Just access.
              </p>
            </div>
          </div>
        )}

        {/* ── What you'll get ── */}
        <div style={{ padding: '56px 0 0', animation: 'fadeUp 0.6s ease-out 0.3s both' }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#BFBFBA',
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20,
          }}>
            What you'll get
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              {
                icon: '💬',
                title: 'A clear signal based on probabilities, not opinions',
                desc: 'The model weighs price position, loss risk, and upside potential across 2,000 simulated scenarios — and gives you one actionable answer: buy, hold, reduce, or get out. No gut feeling, no guesswork.',
              },
              {
                icon: '📉',
                title: 'A warning before the correction, not after',
                desc: "Most tools only tell you when to buy. This one also flags when the price is dangerously stretched above its fair value — so you can reduce before the market does it for you.",
              },
              {
                icon: '🛡️',
                title: 'Your real odds of losing money at each horizon',
                desc: "If you buy today, what's the probability you're down in 6 months? In a year? In three years? The model runs 2,000 scenarios and gives you an actual number, not a feeling.",
              },
              {
                icon: '📊',
                title: 'Backtested against every month since 2016',
                desc: 'When it said "buy," the price was higher 12 months later 98% of the time. When it said "reduce" or "sell," every major correction followed. No hindsight — only data available at that moment was used. Everything is shown openly inside.',
              },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="feature-card" style={{
                display: 'flex', gap: 14, padding: '16px 18px',
                border: '1px solid #F1F1EF', borderRadius: 8,
                transition: 'border-color 0.2s, background 0.2s',
              }}>
                <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#37352F', marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 13, color: '#9B9A97', lineHeight: 1.55 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Under the hood ── */}
        <div style={{ padding: '40px 0', animation: 'fadeUp 0.6s ease-out 0.4s both' }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: '#BFBFBA',
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20,
          }}>
            Under the hood
          </div>
          <div style={{
            padding: '20px 22px', background: '#FAFAF8',
            border: '1px solid #E8E5E0', borderRadius: 10,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                {
                  label: 'Power Law — WLS + RANSAC',
                  detail: 'Weighted Least Squares on 16 years of daily data with 4-year recency decay. RANSAC for a robust support floor that excludes bubble peaks. EVT/Generalized Pareto Distribution for the empirical upside cap.',
                },
                {
                  label: 'Fractal volatility — MMAR',
                  detail: "Mandelbrot's Multifractal Model of Asset Returns with Hurst exponent via DFA and multifractal partition function. Captures fat tails, volatility clustering, and long memory that Gaussian models miss entirely.",
                },
                {
                  label: 'Regime detection — OU diagnostic',
                  detail: 'Ornstein-Uhlenbeck process with two regimes (calm and volatile). Used as a regime diagnostic — not as the MC engine. The simulation runs on pure MMAR/Hurst dynamics to avoid artificially dampening tail risk.',
                },
                {
                  label: 'Monte Carlo — 2,000 paths, 3-year horizon',
                  detail: 'Fractal cascades, empirical shock resampling, Hurst-correlated noise. Single unified run — 1Y and 3Y percentiles extracted from the same paths. RANSAC reflective floor with empirically calibrated break probability.',
                },
                {
                  label: 'Signal calibration — walk-forward backtest',
                  detail: 'Buy score weights and sell thresholds calibrated by grid search against historical returns. Two independent sell paths. Probabilistic calibration table shows how well MC loss estimates matched reality across every market cycle.',
                },
              ].map(({ label, detail }) => (
                <div key={label} style={{ display: 'flex', gap: 12 }}>
                  <div style={{
                    width: 3, borderRadius: 2, background: '#E8E5E0',
                    flexShrink: 0, alignSelf: 'stretch', minHeight: 20,
                  }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#37352F', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 12, color: '#9B9A97', lineHeight: 1.55 }}>{detail}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16,
              textAlign: 'center', marginTop: 20, paddingTop: 16,
              borderTop: '1px solid #E8E5E0',
            }}>
              {[
                { value: '16yr', label: 'of daily data' },
                { value: '2,000', label: 'MC paths' },
                { value: '98%', label: 'buy accuracy' },
                { value: '5', label: 'signal levels' },
              ].map(({ value, label }) => (
                <div key={label}>
                  <div style={{
                    fontSize: 20, fontWeight: 700,
                    fontFamily: "'DM Mono', monospace", color: '#37352F',
                  }}>{value}</div>
                  <div style={{ fontSize: 11, color: '#9B9A97', marginTop: 3 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Disclaimer ── */}
        <div style={{ paddingBottom: 40 }}>
          <div style={{
            padding: '14px 18px', background: '#FFFBF0',
            border: '1px solid #F2E8C9', borderRadius: 8,
          }}>
            <p style={{ fontSize: 12, color: '#9B8A5E', lineHeight: 1.6, margin: 0 }}>
              <strong>Not financial advice.</strong> Past signal accuracy doesn't guarantee future results.
              Bitcoin is volatile and the model can be wrong. Use this as a structured framework
              for thinking about risk — not as a trading system. The 98% accuracy figure is historical
              and based on data the model was partially trained on.
            </p>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          borderTop: '1px solid #F1F1EF', padding: '20px 0 40px',
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', flexWrap: 'wrap', gap: 8,
        }}>
          <span style={{ fontSize: 11, color: '#BFBFBA' }}>
            <a href="https://www.commonsense.finance/" target="_blank" rel="noopener noreferrer"
              style={{ fontWeight: 600, color: '#9B9A97' }}>CommonSense</a>
            {' & '}
            <a href="https://www.linkedin.com/in/eduforte/" target="_blank" rel="noopener noreferrer"
              style={{ fontWeight: 600, color: '#9B9A97' }}>Edu Forte</a>
            <span style={{ color: '#E8E5E0' }}> · Barcelona</span>
          </span>
          <span style={{ fontSize: 11, color: '#E8E5E0' }}>Not financial advice</span>
        </div>

      </div>
    </div>
  );
}
