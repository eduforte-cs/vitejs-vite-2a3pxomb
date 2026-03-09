# MMAR Bitcoin Dashboard

**Should I buy Bitcoin today?** A quantitative answer based on 15 years of data, fractal math, and 500 simulated futures.

Built by [CommonSense](https://www.commonsense.finance/) & [Edu Forte](https://www.linkedin.com/in/eduforte/).

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project
2. Go to **Authentication → Providers → Email**
3. Enable **Email provider** with **Confirm email** turned ON
4. (Optional) Customize the email template in **Authentication → Email Templates → Magic Link**

### 2. Configure environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in your Supabase credentials (from **Settings → API**):

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run

```bash
npm install
npm run dev
```

## Architecture

```
Landing (email input)
  → Supabase magic link
  → Auth callback
  → Dashboard (full MMAR analysis)
```

### Data pipeline
- **CoinGecko API**: Daily BTC prices 2013–today (~4,500 data points)
- **Binance/Kraken API**: Live spot price (refreshes every 60s)
- **Fallback**: Monthly hardcoded data + synthetic if APIs unavailable

### Model stack
1. **Weighted Least Squares** Power Law regression (log-log, exponential decay weighting)
2. **Detrended Fluctuation Analysis** for Hurst exponent
3. **Multifractal partition function** for intermittency (λ²)
4. **Regime-switching Ornstein-Uhlenbeck** mean-reversion (calm + volatile regimes, Markov transitions)
5. **500-path Monte Carlo** with MMAR fractal cascades + empirical shock resampling
6. **Composite scoring** (7 signals) for YES / CAUTIOUSLY / NOT NOW verdict

All calculations run in the browser. No backend computation.

## Deployment

Works on Vercel, Netlify, or any static host:

```bash
npm run build
# Deploy the `dist/` folder
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in your hosting platform.

### Supabase redirect URL

In **Authentication → URL Configuration**, add your production URL to **Redirect URLs**:
```
https://your-domain.com
```

## License

© CommonSense Technologies S.L.
