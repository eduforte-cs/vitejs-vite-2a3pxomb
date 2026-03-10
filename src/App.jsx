import React from "react";
import { useState, useCallback, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceLine, Legend
} from "recharts";
import { supabase } from "./supabase.js";

// ══════════════════════════════════════════════════════
// CONSTANTS & MATH CORE (unchanged engine)
// ══════════════════════════════════════════════════════
const GENESIS = new Date("2009-01-03").getTime();
const MS_DAY = 86400000;
function daysSinceGenesis(dateStr) {
  return (new Date(dateStr).getTime() - GENESIS) / MS_DAY;
}

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function fitPowerLaw(prices) {
  const pts = prices.map(p => ({ t: daysSinceGenesis(p.date), price: p.price })).filter(p => p.t > 0 && p.price > 0);
  const logT = pts.map(p => Math.log(p.t));
  const logP = pts.map(p => Math.log(p.price));
  const n = pts.length;

  // ── Weighted Least Squares ──
  // Exponential weights: recent data matters more, early illiquid data matters less
  // Half-life of ~4 years (1460 days in log-time units)
  const tMax = logT[n - 1];
  const halfLife = Math.log(daysSinceGenesis("2020-01-01")) - Math.log(daysSinceGenesis("2016-01-01")); // ~4yr in log-t space
  const decay = Math.LN2 / halfLife;
  const rawW = logT.map(lt => Math.exp(-decay * (tMax - lt)));
  const wSum = rawW.reduce((s, w) => s + w, 0);
  const w = rawW.map(wi => wi / wSum); // normalized weights

  // Weighted means
  const mT = logT.reduce((s, x, i) => s + w[i] * x, 0);
  const mP = logP.reduce((s, y, i) => s + w[i] * y, 0);

  // Weighted slope and intercept
  const b = logT.reduce((s, x, i) => s + w[i] * (x - mT) * (logP[i] - mP), 0) /
            logT.reduce((s, x, i) => s + w[i] * (x - mT) ** 2, 0);
  const a = mP - b * mT;

  // Residuals (unweighted — these represent actual deviations for σ-band purposes)
  const residuals = pts.map(p => Math.log(p.price) - (a + b * Math.log(p.t)));
  const resMean = residuals.reduce((s, r) => s + r, 0) / n;
  const resStd = Math.sqrt(residuals.reduce((s, r) => s + (r - resMean) ** 2, 0) / n);

  // Weighted R² (how well the model fits with the weighting that matters)
  const ssTot = logP.reduce((s, y, i) => s + w[i] * (y - mP) ** 2, 0);
  const ssRes = logP.reduce((s, y, i) => s + w[i] * (y - (a + b * logT[i])) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;

  return { a, b, residuals, resMean, resStd, r2, pts };
}

function plPrice(a, b, t) { return Math.exp(a + b * Math.log(t)); }

function hurstDFA(returns) {
  const n = returns.length;

  // Step 1: Cumulative profile (integrated demeaned series)
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const profile = new Float64Array(n);
  profile[0] = returns[0] - mean;
  for (let i = 1; i < n; i++) profile[i] = profile[i - 1] + (returns[i] - mean);

  // Step 2: Window sizes (log-spaced from 10 to n/4)
  const scales = [];
  for (let s = 10; s <= Math.floor(n / 4); s = Math.max(s + 1, Math.floor(s * 1.5))) scales.push(s);

  const logS = [], logF = [];

  for (const s of scales) {
    const nSegs = Math.floor(n / s);
    if (nSegs < 2) continue;

    let totalVar = 0;
    let segCount = 0;

    // Forward segments
    for (let seg = 0; seg < nSegs; seg++) {
      const start = seg * s;

      // Linear detrend within segment (DFA-1)
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < s; i++) {
        sx += i; sy += profile[start + i];
        sxx += i * i; sxy += i * profile[start + i];
      }
      const det = s * sxx - sx * sx;
      if (Math.abs(det) < 1e-20) continue;
      const slope = (s * sxy - sx * sy) / det;
      const intercept = (sy - slope * sx) / s;

      // RMS of detrended segment
      let rms = 0;
      for (let i = 0; i < s; i++) {
        const trend = intercept + slope * i;
        const diff = profile[start + i] - trend;
        rms += diff * diff;
      }
      totalVar += rms / s;
      segCount++;
    }

    // Also do backward segments (from end) for better coverage — standard DFA practice
    for (let seg = 0; seg < nSegs; seg++) {
      const start = n - (seg + 1) * s;
      if (start < 0) break;

      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (let i = 0; i < s; i++) {
        sx += i; sy += profile[start + i];
        sxx += i * i; sxy += i * profile[start + i];
      }
      const det = s * sxx - sx * sx;
      if (Math.abs(det) < 1e-20) continue;
      const slope = (s * sxy - sx * sy) / det;
      const intercept = (sy - slope * sx) / s;

      let rms = 0;
      for (let i = 0; i < s; i++) {
        const trend = intercept + slope * i;
        const diff = profile[start + i] - trend;
        rms += diff * diff;
      }
      totalVar += rms / s;
      segCount++;
    }

    if (segCount > 0) {
      const F = Math.sqrt(totalVar / segCount);
      if (F > 0 && isFinite(F)) {
        logS.push(Math.log(s));
        logF.push(Math.log(F));
      }
    }
  }

  // Step 3: Linear fit log(F) vs log(s) — slope = α ≈ H
  const nx = logS.length;
  if (nx < 3) return { H: 0.6, points: [] };

  const mx = logS.reduce((a, b) => a + b, 0) / nx;
  const my = logF.reduce((a, b) => a + b, 0) / nx;
  const num = logS.reduce((s, x, i) => s + (x - mx) * (logF[i] - my), 0);
  const den = logS.reduce((s, x) => s + (x - mx) ** 2, 0);
  const alpha = den > 0 ? num / den : 0.6;

  return {
    H: Math.max(0.45, Math.min(alpha, 0.92)),
    points: logS.map((ls, i) => ({ logScale: +ls.toFixed(3), logF: +logF[i].toFixed(3) }))
  };
}

function partitionFunction(returns) {
  const abs = returns.map(r => Math.abs(r) + 1e-12);
  const n = abs.length;
  const qs = [-2, -1, 1, 2, 3, 4, 5];
  const scales = [8, 16, 32, 64, 128];
  const result = [];
  for (const q of qs) {
    const pts = [];
    for (const sc of scales) {
      if (sc * 3 > n) continue;
      let Z = 0, cnt = 0;
      for (let i = 0; i + sc <= n; i += sc) {
        let s = 0; for (let j = i; j < i + sc; j++) s += abs[j];
        if (s > 0) { Z += Math.pow(s, q); cnt++; }
      }
      if (cnt > 0 && isFinite(Z) && Z > 0) pts.push([Math.log(sc), Math.log(Z / cnt)]);
    }
    if (pts.length >= 3) {
      const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const slope = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
      if (isFinite(slope)) result.push({ q, tau: +slope.toFixed(4) });
    }
  }
  return result;
}

function fitLambda2(tauData) {
  const pts = tauData.filter(t => t.q > 0 && t.q <= 4);
  if (pts.length < 3) return 0.08;
  let sQ2 = 0, sQ4 = 0, sTQ = 0, sTQ2 = 0;
  const n = pts.length;
  pts.forEach(({ q, tau }) => { sQ2 += q * q; sQ4 += q ** 4; sTQ += tau * q; sTQ2 += tau * q * q; });
  const det = n * sQ4 - sQ2 * sQ2;
  if (Math.abs(det) < 1e-10) return 0.08;
  const b = (n * sTQ2 - sQ2 * sTQ) / det;
  return Math.max(0.02, Math.min(-2 * b, 0.45));
}

function estimateKappa(residuals) {
  // Simple single-regime kappa for backward compatibility
  const n = residuals.length;
  let sXX = 0, sXY = 0, sX = 0, sY = 0;
  for (let i = 1; i < n; i++) { const x = residuals[i - 1], y = residuals[i]; sXX += x * x; sXY += x * y; sX += x; sY += y; }
  const m = n - 1;
  const phi = (m * sXY - sX * sY) / (m * sXX - sX * sX);
  const phiClamped = Math.max(0.90, Math.min(phi, 0.9995));
  return -Math.log(phiClamped);
}

function estimateRegimeSwitchingOU(residuals, resReturns) {
  const n = resReturns.length;
  if (n < 60) {
    const k = estimateKappa(residuals);
    return {
      regimes: [{ kappa: k, volScale: 1.0, label: "single" }],
      transition: [[1]], currentRegime: 0,
      globalKappa: k, halfLife: Math.round(Math.log(2) / k),
    };
  }

  // ── Step 1: Classify each day into high-vol or low-vol regime ──
  // Use 30-day rolling absolute returns as volatility proxy
  const window = 30;
  const rollingVol = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) { sum += Math.abs(resReturns[j]); cnt++; }
    rollingVol[i] = sum / cnt;
  }

  // Median split into 2 regimes
  const sorted = Array.from(rollingVol).sort((a, b) => a - b);
  const medianVol = sorted[Math.floor(n / 2)];
  const regime = new Uint8Array(n); // 0 = calm, 1 = volatile
  for (let i = 0; i < n; i++) regime[i] = rollingVol[i] > medianVol ? 1 : 0;

  // ── Step 2: Estimate kappa for each regime ──
  function kappaForRegime(regimeId) {
    let sXX = 0, sXY = 0, sX = 0, sY = 0, cnt = 0;
    // residuals is offset: dailyResiduals has one more element than resReturns
    // residuals[i] corresponds to resReturns[i-1] → resReturns[i]
    for (let i = 1; i < n; i++) {
      if (regime[i] !== regimeId) continue;
      const x = residuals[i]; // using residuals aligned to resReturns index
      const y = residuals[i + 1];
      if (y === undefined) continue;
      sXX += x * x; sXY += x * y; sX += x; sY += y; cnt++;
    }
    if (cnt < 20) return null;
    const phi = (cnt * sXY - sX * sY) / (cnt * sXX - sX * sX);
    const phiClamped = Math.max(0.85, Math.min(phi, 0.9998));
    return -Math.log(phiClamped);
  }

  const kCalm = kappaForRegime(0);
  const kVol = kappaForRegime(1);

  // ── Step 3: Volatility scale per regime ──
  let volCalm = 0, cntCalm = 0, volVol = 0, cntVol = 0;
  for (let i = 0; i < n; i++) {
    const v = resReturns[i] * resReturns[i];
    if (regime[i] === 0) { volCalm += v; cntCalm++; }
    else { volVol += v; cntVol++; }
  }
  const stdCalm = Math.sqrt(cntCalm > 0 ? volCalm / cntCalm : 1);
  const stdVol = Math.sqrt(cntVol > 0 ? volVol / cntVol : 1);
  const globalStd = Math.sqrt((volCalm + volVol) / n);
  const scaleCalm = globalStd > 0 ? stdCalm / globalStd : 0.7;
  const scaleVol = globalStd > 0 ? stdVol / globalStd : 1.4;

  // ── Step 4: Transition matrix ──
  let t00 = 0, t01 = 0, t10 = 0, t11 = 0;
  for (let i = 1; i < n; i++) {
    if (regime[i - 1] === 0 && regime[i] === 0) t00++;
    else if (regime[i - 1] === 0 && regime[i] === 1) t01++;
    else if (regime[i - 1] === 1 && regime[i] === 0) t10++;
    else t11++;
  }
  const s0 = t00 + t01 || 1;
  const s1 = t10 + t11 || 1;
  const transition = [
    [t00 / s0, t01 / s0],
    [t10 / s1, t11 / s1],
  ];

  // Current regime (last 20 days majority)
  let recent0 = 0, recent1 = 0;
  for (let i = Math.max(0, n - 20); i < n; i++) {
    if (regime[i] === 0) recent0++; else recent1++;
  }
  const currentRegime = recent1 > recent0 ? 1 : 0;

  const regimes = [
    { kappa: kCalm || 0.002, volScale: scaleCalm, label: "calm" },
    { kappa: kVol || 0.0005, volScale: scaleVol, label: "volatile" },
  ];

  // Global kappa (weighted by time spent in each regime)
  const pCalm = cntCalm / n;
  const globalKappa = pCalm * regimes[0].kappa + (1 - pCalm) * regimes[1].kappa;

  return {
    regimes, transition, currentRegime,
    globalKappa, halfLife: Math.round(Math.log(2) / globalKappa),
    halfLifeCalm: Math.round(Math.log(2) / regimes[0].kappa),
    halfLifeVol: Math.round(Math.log(2) / regimes[1].kappa),
    pCalm: +(pCalm * 100).toFixed(0),
  };
}

function generateCascade(nSteps, lambda2) {
  const levels = 10, size = 1 << levels;
  const m = new Float64Array(size).fill(1.0);
  const sigma = Math.sqrt(lambda2 * Math.LN2);
  for (let lv = 0; lv < levels; lv++) {
    const blocks = 1 << lv, bsz = size / blocks;
    for (let b = 0; b < blocks; b++) {
      const mult = Math.exp(sigma * randn() - sigma * sigma / 2);
      for (let i = b * bsz; i < (b + 1) * bsz; i++) m[i] *= mult;
    }
  }
  let total = 0; for (let i = 0; i < size; i++) total += m[i];
  const tt = new Float64Array(nSteps + 1); let cum = 0;
  for (let t = 0; t <= nSteps; t++) { tt[t] = cum; const idx = Math.min(Math.floor((t / nSteps) * size), size - 1); cum += m[idx] / total; }
  tt[nSteps] = 1.0;
  return tt;
}

function simulatePathsPL(nPaths, nDays, H, lambda2, resStd, resMean, a, b, t0, ouRegimes, currentResidual, resReturns) {
  const empN = resReturns.length;
  let empVar = 0; for (let i = 0; i < empN; i++) empVar += resReturns[i] * resReturns[i];
  const empStd = Math.sqrt(empVar / empN) || 1;
  const cap = 2.5 * resStd;
  const rho = Math.pow(2, 2 * H - 1) - 1;
  const rhoClamp = Math.max(-0.5, Math.min(rho, 0.8));
  const mixAlpha = rhoClamp;
  const mixBeta = Math.sqrt(Math.max(0, 1 - rhoClamp * rhoClamp));

  const { regimes, transition, currentRegime } = ouRegimes;
  const nRegimes = regimes.length;

  const paths = [];
  for (let p = 0; p < nPaths; p++) {
    const tt = generateCascade(nDays, lambda2);
    const prices = new Float64Array(nDays + 1);
    prices[0] = plPrice(a, b, t0) * Math.exp(currentResidual);
    let X = currentResidual, prevNorm = 0;
    let reg = currentRegime;

    for (let t = 1; t <= nDays; t++) {
      // Regime switch (Markov)
      if (nRegimes > 1) {
        const r = Math.random();
        reg = r < transition[reg][0] ? 0 : 1;
      }

      const kappa = regimes[reg].kappa;
      const volMult = regimes[reg].volScale;
      const targetShockStd = resStd * Math.sqrt(2 * kappa) * volMult;

      const plNow = plPrice(a, b, t0 + t);
      const dTheta = Math.max(tt[t] - tt[t - 1], 1e-10) * nDays;
      const volScale = Math.min(Math.sqrt(dTheta), 3.0);
      const rawShock = resReturns[Math.floor(Math.random() * empN)];
      const normShock = rawShock / empStd;
      const correlatedNorm = mixAlpha * prevNorm + mixBeta * normShock;
      prevNorm = correlatedNorm;
      const shock = correlatedNorm * targetShockStd * volScale;
      X = X - kappa * (X - resMean) + shock;
      X = Math.max(-cap, Math.min(cap, X));
      prices[t] = plNow * Math.exp(X);
    }
    paths.push(prices);
  }
  return paths;
}

function computePercentiles(paths, nDays) {
  const step = 5, result = [];
  for (let t = 0; t <= nDays; t += step) {
    const vals = paths.map(p => p[t]).sort((a, b) => a - b);
    const n = vals.length;
    result.push({ t, p5: vals[Math.floor(n * 0.05)], p25: vals[Math.floor(n * 0.25)], p50: vals[Math.floor(n * 0.50)], p75: vals[Math.floor(n * 0.75)], p95: vals[Math.floor(n * 0.95)] });
  }
  return result;
}

// ══════════════════════════════════════════════════════
// DATA — historical + CoinGecko daily + live APIs
// ══════════════════════════════════════════════════════

// Pre-CoinGecko era: monthly data 2010–2013 March (only period without reliable daily data)
const EARLY_BTC = [
  ["2010-07-18",0.05],["2010-08-01",0.07],["2010-09-01",0.06],["2010-10-01",0.06],["2010-11-01",0.20],["2010-12-01",0.23],
  ["2011-01-01",0.30],["2011-02-01",0.85],["2011-03-01",0.90],["2011-04-01",0.75],["2011-05-01",3.50],["2011-06-01",18.0],
  ["2011-07-01",13.5],["2011-08-01",10.5],["2011-09-01",8.90],["2011-10-01",3.80],["2011-11-01",2.50],["2011-12-01",4.20],
  ["2012-01-01",6.20],["2012-02-01",4.50],["2012-03-01",4.90],["2012-04-01",5.00],["2012-05-01",5.10],["2012-06-01",6.50],
  ["2012-07-01",7.10],["2012-08-01",9.90],["2012-09-01",12.4],["2012-10-01",11.5],["2012-11-01",12.5],["2012-12-01",13.4],
  ["2013-01-01",13.5],["2013-02-01",23.0],["2013-03-01",34.0],
].map(([date, price]) => ({ date, price }));

// Monthly fallback for 2013–2023 (used only if CoinGecko fails)
const MONTHLY_FALLBACK = [
  ["2013-04-01",93],["2013-05-01",127],["2013-06-01",102],["2013-07-01",90.0],["2013-08-01",109],["2013-09-01",132],
  ["2013-10-01",145],["2013-11-01",204],["2013-12-01",805],
  ["2014-01-01",820],["2014-02-01",830],["2014-03-01",620],["2014-04-01",450],["2014-05-01",440],["2014-06-01",595],
  ["2014-07-01",580],["2014-08-01",495],["2014-09-01",400],["2014-10-01",335],["2014-11-01",330],["2014-12-01",320],
  ["2015-01-01",265],["2015-02-01",255],["2015-03-01",260],["2015-04-01",220],["2015-05-01",235],["2015-06-01",258],
  ["2015-07-01",275],["2015-08-01",270],["2015-09-01",235],["2015-10-01",270],["2015-11-01",360],["2015-12-01",430],
  ["2016-01-01",380],["2016-02-01",390],["2016-03-01",415],["2016-04-01",420],["2016-05-01",450],["2016-06-01",680],
  ["2016-07-01",660],["2016-08-01",580],["2016-09-01",605],["2016-10-01",640],["2016-11-01",700],["2016-12-01",900],
  ["2017-01-01",970],["2017-02-01",1180],["2017-03-01",1050],["2017-04-01",1350],["2017-05-01",1800],["2017-06-01",2800],
  ["2017-07-01",2700],["2017-08-01",4350],["2017-09-01",4350],["2017-10-01",5700],["2017-11-01",9800],["2017-12-01",10900],
  ["2018-01-01",13500],["2018-02-01",9200],["2018-03-01",7000],["2018-04-01",7500],["2018-05-01",7700],["2018-06-01",6350],
  ["2018-07-01",8200],["2018-08-01",6550],["2018-09-01",6600],["2018-10-01",6550],["2018-11-01",4300],["2018-12-01",3750],
  ["2019-01-01",3600],["2019-02-01",3800],["2019-03-01",3950],["2019-04-01",5000],["2019-05-01",5750],["2019-06-01",9100],
  ["2019-07-01",10700],["2019-08-01",9600],["2019-09-01",8200],["2019-10-01",8300],["2019-11-01",7500],["2019-12-01",7200],
  ["2020-01-01",7200],["2020-02-01",8600],["2020-03-01",6400],["2020-04-01",8600],["2020-05-01",9400],["2020-06-01",9100],
  ["2020-07-01",11300],["2020-08-01",11600],["2020-09-01",10800],["2020-10-01",13300],["2020-11-01",18900],["2020-12-01",29000],
  ["2021-01-01",33100],["2021-02-01",45200],["2021-03-01",58800],["2021-04-01",57700],["2021-05-01",37300],["2021-06-01",35000],
  ["2021-07-01",41500],["2021-08-01",47100],["2021-09-01",43800],["2021-10-01",61300],["2021-11-01",57000],["2021-12-01",46200],
  ["2022-01-01",38500],["2022-02-01",43100],["2022-03-01",45500],["2022-04-01",37600],["2022-05-01",31800],["2022-06-01",19800],
  ["2022-07-01",23300],["2022-08-01",20000],["2022-09-01",19400],["2022-10-01",20500],["2022-11-01",17200],["2022-12-01",16500],
  ["2023-01-01",23100],["2023-02-01",23100],["2023-03-01",28400],["2023-04-01",29200],["2023-05-01",27200],["2023-06-01",30500],
  ["2023-07-01",29200],["2023-08-01",26000],["2023-09-01",27000],["2023-10-01",34500],["2023-11-01",37700],["2023-12-01",42300],
].map(([date, price]) => ({ date, price }));

function mergeAndDedupe(...sources) {
  const map = new Map();
  for (const src of sources) {
    for (const d of src) {
      if (d.price > 0) map.set(d.date, d);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Fetch daily data from CoinGecko (April 2013 – today)
async function fetchCoinGeckoDaily(onStatus) {
  const from = 1364774400; // April 1, 2013
  const now = Math.floor(Date.now() / 1000);
  
  // Split into 3 chunks to stay within CoinGecko limits
  const mid1 = 1483228800; // Jan 1, 2017
  const mid2 = 1609459200; // Jan 1, 2021
  
  const chunks = [
    { from, to: mid1, label: "2013–2016" },
    { from: mid1, to: mid2, label: "2017–2020" },
    { from: mid2, to: now, label: "2021–today" },
  ];
  
  let allPrices = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    onStatus?.(`Fetching daily history ${c.label} (CoinGecko)... ${i + 1}/3`);
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${c.from}&to=${c.to}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`CoinGecko error: ${r.status}`);
    const j = await r.json();
    allPrices = allPrices.concat(j.prices || []);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1500)); // rate limit
  }
  
  if (allPrices.length < 500) throw new Error("Insufficient CoinGecko data");
  
  return allPrices.map(([ts, price]) => ({
    date: new Date(ts).toISOString().slice(0, 10),
    price: +price.toFixed(2),
  }));
}

// Fetch only the live spot price from Binance or Kraken
async function fetchSpotPrice() {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const spot = parseFloat(j.price);
    if (spot > 1000) return { spot, source: "Binance" };
  } catch (e) { /* try Kraken */ }
  try {
    const r = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const spot = parseFloat(j.result?.XXBTZUSD?.c?.[0] || j.result?.XBTUSD?.c?.[0]);
    if (spot > 1000) return { spot, source: "Kraken" };
  } catch (e) { /* both failed */ }
  return { spot: null, source: null };
}

// Fallback: Binance klines if CoinGecko fails entirely
async function fetchBinanceKlines() {
  const r = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=2000", { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("Binance klines error");
  const raw = await r.json();
  if (!Array.isArray(raw) || raw.length < 300) throw new Error("Insufficient data");
  return raw.map(k => ({ date: new Date(k[0]).toISOString().slice(0, 10), price: parseFloat(k[4]) }));
}

function generateSyntheticBTC() {
  const synthFrom2020 = [];
  const trendPts = [[0,7200],[120,12000],[365,29000],[500,60000],[600,30000],[730,16000],[900,25000],[1095,45000],[1300,70000],[1500,58000],[1700,85000],[1826,71000]];
  for (let i = 0; i < 1826; i++) {
    const d = new Date("2020-01-01"); d.setDate(d.getDate() + i);
    let trend = 7200;
    for (let j = 0; j < trendPts.length - 1; j++) {
      const [t0, p0] = trendPts[j], [t1, p1] = trendPts[j + 1];
      if (i >= t0 && i <= t1) { trend = p0 + (p1 - p0) * (i - t0) / (t1 - t0); break; }
    }
    synthFrom2020.push({ date: d.toISOString().slice(0, 10), price: Math.round(trend * (1 + 0.08 * Math.sin(2 * Math.PI * i / 365))) });
  }
  return mergeAndDedupe(EARLY_BTC, MONTHLY_FALLBACK, synthFrom2020);
}

async function fetchBTC(onStatus) {
  let dailyData = null;
  let dataSource = "";
  let spot = null;
  let spotSource = "";
  
  // Strategy 1: CoinGecko for all daily history (2013–today)
  try {
    dailyData = await fetchCoinGeckoDaily(onStatus);
    dataSource = "CoinGecko daily";
  } catch (e) {
    console.warn("CoinGecko failed:", e.message);
    // Strategy 2: Binance klines (2020+ only) + monthly fallback for 2013-2019
    try {
      onStatus?.("CoinGecko unavailable. Fetching from Binance...");
      const klines = await fetchBinanceKlines();
      dailyData = [...MONTHLY_FALLBACK, ...klines];
      dataSource = "Binance + monthly fallback";
    } catch (e2) {
      console.warn("Binance klines failed:", e2.message);
    }
  }
  
  // Get live spot price
  onStatus?.("Fetching live spot price...");
  const spotResult = await fetchSpotPrice();
  spot = spotResult.spot;
  spotSource = spotResult.source || "";
  
  // Merge and return
  if (dailyData) {
    const merged = mergeAndDedupe(EARLY_BTC, dailyData);
    // Update last entry with live spot if available
    if (spot && merged.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const lastEntry = merged[merged.length - 1];
      if (lastEntry.date === today) {
        lastEntry.price = spot;
      } else {
        merged.push({ date: today, price: spot });
      }
    }
    const parts = [spotSource, dataSource].filter(Boolean);
    const uniqueParts = [...new Set(parts)];
    const source = `${uniqueParts.join(" + ")} (${merged.length.toLocaleString()} days)`;
    return { data: merged, source, spot };
  }
  
  // Full fallback: synthetic
  return { data: generateSyntheticBTC(), source: "Synthetic (APIs unavailable)", spot: null };
}

// ══════════════════════════════════════════════════════
// FORMATTERS
// ══════════════════════════════════════════════════════
const fmt = (n, d = 2) => (n != null && isFinite(n)) ? n.toFixed(d) : "–";
const fmtK = v => v != null && isFinite(v) ? (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`) : "–";
const fmtPct = v => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;
const fmtY = v => { const val = Math.pow(10, v); if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`; if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}k`; return `$${val.toFixed(0)}`; };

function normInv(p) {
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
  const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
  const c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209, 0.0276438810333863, 0.0038405729373609, 0.0003951896511349, 0.0000321767881768, 0.0000002888167364, 0.0000003960315187];
  const u = p - 0.5;
  if (Math.abs(u) <= 0.42) { const r = u * u; return u * (((a[3] * r + a[2]) * r + a[1]) * r + a[0]) / ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1); }
  const r0 = u > 0 ? Math.log(-Math.log(1 - p)) : Math.log(-Math.log(p));
  let r = c[0] + r0 * (c[1] + r0 * (c[2] + r0 * (c[3] + r0 * (c[4] + r0 * (c[5] + r0 * (c[6] + r0 * (c[7] + r0 * c[8])))))));
  return u < 0 ? -r : r;
}

function normCDF(z) {
  const t = 1 / (1 + 0.2315419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z > 0 ? 1 - p : p;
}

// ══════════════════════════════════════════════════════
// PLAIN LANGUAGE HELPERS (for investors)
// ══════════════════════════════════════════════════════
function getVerdictPlain(sig) {
  if (sig > 1.8) return { emoji: "🔴", label: "Overheated", desc: "Bitcoin is trading well above its long-term trend. Historically, these levels precede corrections.", color: "#EB5757" };
  if (sig > 0.8) return { emoji: "🟡", label: "Above trend", desc: "Price is above fair value. Consider taking some profits or holding with caution.", color: "#E8A838" };
  if (sig > -0.5) return { emoji: "🟢", label: "Fair value", desc: "Bitcoin is trading near its structural equilibrium. A neutral position is reasonable.", color: "#27AE60" };
  if (sig > -1.5) return { emoji: "🔵", label: "Undervalued", desc: "Price is below the long-term trend. Historically a good zone to accumulate.", color: "#2F80ED" };
  return { emoji: "💎", label: "Deep value", desc: "Bitcoin is at historically low valuations relative to its growth trajectory. Strong buy signal.", color: "#6FCF97" };
}

function getVolLabel(annVol) {
  if (annVol < 0.45) return { label: "Low", color: "#27AE60", desc: "Calm market" };
  if (annVol < 0.80) return { label: "Normal", color: "#828282", desc: "Typical conditions" };
  if (annVol < 1.20) return { label: "High", color: "#E8A838", desc: "Elevated volatility" };
  return { label: "Extreme", color: "#EB5757", desc: "Storm conditions" };
}

// ══════════════════════════════════════════════════════
// UI COMPONENTS
// ══════════════════════════════════════════════════════

function Toggle({ label, open, onToggle, count, children }) {
  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "none", border: "none", cursor: "pointer",
          padding: "10px 0", textAlign: "left",
        }}
      >
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 20, height: 20, fontSize: 10, color: "#9B9A97",
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 0.15s ease",
        }}>▶</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#37352F", letterSpacing: "-0.01em" }}>{label}</span>
        {count != null && (
          count === "live" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#27AE60", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#27AE60", animation: "livepulse 2s ease-in-out infinite" }} />
              live
            </span>
          ) : (
            <span style={{
              fontSize: 11, color: "#9B9A97", background: "#F1F1EF",
              padding: "1px 7px", borderRadius: 3, fontWeight: 400,
            }}>{count}</span>
          )
        )}
      </button>
      {open && <div className="toggle-content">{children}</div>}
    </div>
  );
}

function Callout({ emoji, children, bg = "#F1F1EF", border }) {
  return (
    <div style={{
      display: "flex", gap: 12, padding: "14px 16px",
      background: bg, borderRadius: 4,
      borderLeft: border ? `3px solid ${border}` : undefined,
      marginBottom: 12,
    }}>
      <span style={{ fontSize: 20, lineHeight: 1.4, flexShrink: 0 }}>{emoji}</span>
      <div style={{ flex: 1, fontSize: 14, color: "#37352F", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function Metric({ label, value, sub, color }) {
  return (
    <div style={{ padding: "12px 0" }}>
      <div style={{ fontSize: 11, color: "#9B9A97", fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || "#37352F", letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#9B9A97", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "#E8E5E0", margin: "4px 0" }} />;
}

function Dot({ color, size = 8 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

function ProgressBar({ value, max = 100, color = "#2F80ED", height = 6 }) {
  return (
    <div style={{ height, background: "#F1F1EF", borderRadius: height / 2, overflow: "hidden", flex: 1 }}>
      <div style={{ height: "100%", width: `${Math.min(100, (value / max) * 100)}%`, background: color, borderRadius: height / 2, transition: "width 0.5s ease" }} />
    </div>
  );
}

function DeviationGauge({ sigma, style: outerStyle }) {
  const clamped = Math.max(-2, Math.min(2, sigma));
  const pct = ((clamped + 2) / 4) * 100;
  const zones = [
    { color: "#6FCF97" },
    { color: "#2F80ED" },
    { color: "#27AE60" },
    { color: "#F2994A" },
    { color: "#EB5757" },
  ];
  return (
    <div style={{ ...outerStyle }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "#6FCF97" }}>Cheap</span>
        <span style={{ fontSize: 11, color: "#EB5757" }}>Expensive</span>
      </div>
      <div style={{ position: "relative", height: 12, borderRadius: 6, overflow: "hidden", background: "#F1F1EF" }}>
        <div style={{ display: "flex", height: "100%", position: "absolute", inset: 0 }}>
          {zones.map((z, i) => (
            <div key={i} style={{ flex: 1, background: z.color, opacity: 0.25 }} />
          ))}
        </div>
        <div style={{
          position: "absolute", top: -1, left: `calc(${pct}% - 7px)`,
          width: 14, height: 14, borderRadius: "50%",
          background: "#37352F", border: "2px solid white",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left 0.5s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {[-2, -1, 0, 1, 2].map(s => (
          <span key={s} style={{ fontSize: 9, color: "#BFBFBA", fontFamily: "monospace" }}>{s > 0 ? "+" : ""}{s}σ</span>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════
export default function MMARDashboard() {
  const [phase, setPhase] = useState("loading");
  const [msg, setMsg] = useState("Connecting to market data...");
  const [d, setD] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Toggle states for sections
  const [openSections, setOpenSections] = useState({
    faq_pl: false,
    faq_fractal: false,
    faq_method: false,
    faq_mc: false,
    faq_signal: false,
    faq_data: false,
    faq_accuracy: false,
    faq_ta: false,
    faq_notwhat: false,
    faq_who: false,
    faq_limits: false,
    shouldbuy: true,
    longanswer: false,
    dataview: false,
    drivers: false,
    powerlaw: true,
    levels: false,
    scenarios: true,
    regime: true,
    riskmatrix: false,
    plforward: false,
    montecarlo: false,
    mc3y: false,
    mc3y_chart: false,
    technicals: false,
  });
  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const [plRange, setPlRange] = useState("2020");

  const tooltipStyle = {
    contentStyle: { background: "#FFF", border: "1px solid #E8E5E0", fontSize: 12, borderRadius: 6, color: "#37352F", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", padding: "8px 12px" },
    labelStyle: { color: "#9B9A97" },
  };

  // Auto-refresh spot every 60s
  useEffect(() => {
    if (phase !== "done" || !d) return;
    const refreshSpot = async () => {
      setRefreshing(true);
      try {
        const { spot } = await fetchSpotPrice();
        if (!spot) { setRefreshing(false); return; }
        const { a, b, resMean, resStd, H, lambda2, ouRegimes, t0, resReturns } = d;
        const tNow = daysSinceGenesis(new Date().toISOString().slice(0, 10));
        const plNow = plPrice(a, b, tNow);
        const newResidual = Math.log(spot) - Math.log(plNow);
        const newSigma = (newResidual - resMean) / resStd;
        const paths = simulatePathsPL(200, 365, H, lambda2, resStd, resMean, a, b, tNow, ouRegimes, newResidual, resReturns);
        const pct = computePercentiles(paths, 365);
        const N3Y = 365 * 3;
        const paths3y = simulatePathsPL(200, N3Y, H, lambda2, resStd, resMean, a, b, tNow, ouRegimes, newResidual, resReturns);
        const pct3y = computePercentiles(paths3y, N3Y);
        setD(prev => ({ ...prev, S0: spot, t0: tNow, plToday: plNow, sigmaFromPL: newSigma, currentResidual: newResidual, percentiles: pct, percentiles3y: pct3y, pl1y: +plPrice(a, b, tNow + 365).toFixed(0), pl2y: +plPrice(a, b, tNow + 730).toFixed(0), pl3y: +plPrice(a, b, tNow + 365 * 3).toFixed(0) }));
        setLastRefresh(new Date());
      } catch (e) { console.warn("Refresh:", e); }
      setRefreshing(false);
    };
    const timer = setInterval(refreshSpot, 60000);
    return () => clearInterval(timer);
  }, [phase, d?.a]);

  // Run analysis
  const run = useCallback(async () => {
    setPhase("loading");
    try {
      setMsg("Connecting to market data...");
      const { data: prices, source, spot: liveSpot } = await fetchBTC(setMsg);

      setMsg("Fitting Power Law model...");
      await new Promise(r => setTimeout(r, 20));
      const pl = fitPowerLaw(prices);
      const { a, b, residuals, resMean, resStd, r2 } = pl;
      const lastPrice = prices[prices.length - 1];
      const S0 = lastPrice.price;
      const t0 = daysSinceGenesis(lastPrice.date);
      const plToday = plPrice(a, b, t0);
      const currentResidual = Math.log(S0) - Math.log(plToday);
      const sigmaFromPL = (currentResidual - resMean) / resStd;

      setMsg("Analyzing price dynamics...");
      await new Promise(r => setTimeout(r, 20));
      const dailyStart = prices.findIndex(p => p.date >= "2020-01-01");
      const dailyPrices = prices.slice(dailyStart);
      const dailyResiduals = dailyPrices.map(p => { const t = daysSinceGenesis(p.date); return Math.log(p.price) - Math.log(plPrice(a, b, t)); });
      const resReturns = [];
      for (let i = 1; i < dailyResiduals.length; i++) resReturns.push(dailyResiduals[i] - dailyResiduals[i - 1]);
      const n = resReturns.length;
      const mean = resReturns.reduce((a, b) => a + b, 0) / n;
      const variance = resReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
      const std = Math.sqrt(variance);
      const skew = resReturns.reduce((s, r) => s + ((r - mean) / std) ** 3, 0) / n;
      const kurt = resReturns.reduce((s, r) => s + ((r - mean) / std) ** 4, 0) / n;
      const annualVol = std * Math.sqrt(252);

      setMsg("Estimating fractal structure...");
      await new Promise(r => setTimeout(r, 20));
      const { H, points: hurstPts } = hurstDFA(resReturns);
      const tauData = partitionFunction(resReturns);
      const lambda2 = fitLambda2(tauData);
      const ouRegimes = estimateRegimeSwitchingOU(dailyResiduals, resReturns);
      const kappa = ouRegimes.globalKappa;
      const halfLife = ouRegimes.halfLife;

      setMsg("Running 500 Monte Carlo simulations (1Y)...");
      await new Promise(r => setTimeout(r, 30));
      // Batch MC in chunks of 100 to avoid UI freeze
      let paths = [];
      for (let batch = 0; batch < 5; batch++) {
        const chunk = simulatePathsPL(100, 365, H, lambda2, resStd, resMean, a, b, t0, ouRegimes, currentResidual, resReturns);
        paths = paths.concat(chunk);
        setMsg(`Running Monte Carlo... ${(batch + 1) * 100}/500 (1Y)`);
        await new Promise(r => setTimeout(r, 10));
      }
      const percentiles = computePercentiles(paths, 365);

      // PL chart data — daily resolution (sampled per range for performance)
      const plChart = prices.map(p => {
        const t = daysSinceGenesis(p.date); if (t <= 0 || p.price <= 0) return null;
        const plV = plPrice(a, b, t);
        const lpl = Math.log10(plV); const lprice = Math.log10(p.price);
        return {
          date: p.date, logT: +Math.log10(t).toFixed(4), price: +p.price.toFixed(2), pl: +plV.toFixed(2),
          lPrice: +lprice.toFixed(4), lPl: +lpl.toFixed(4),
          lR2up: +(lpl + (resMean + 2 * resStd) / Math.LN10).toFixed(4),
          lR1up: +(lpl + (resMean + resStd) / Math.LN10).toFixed(4),
          lR1dn: +(lpl + (resMean - resStd) / Math.LN10).toFixed(4),
          lR2dn: +(lpl + (resMean - 2 * resStd) / Math.LN10).toFixed(4),
        };
      }).filter(Boolean);

      // Forecast
      const forecastChart = [];
      const monthsTo2039 = Math.ceil((new Date("2039-01-01") - new Date(lastPrice.date)) / (1000 * 60 * 60 * 24 * 30));
      for (let m = 1; m <= Math.max(24, monthsTo2039); m++) {
        const tF = t0 + m * 30; const plF = plPrice(a, b, tF);
        const fd = new Date(lastPrice.date); fd.setDate(fd.getDate() + m * 30);
        const lplF = Math.log10(plF);
        forecastChart.push({
          date: fd.toISOString().slice(0, 7), logT: +Math.log10(tF).toFixed(4), lPl: +lplF.toFixed(4), lPrice: null,
          lR2up: +(lplF + (resMean + 2 * resStd) / Math.LN10).toFixed(4),
          lR1up: +(lplF + (resMean + resStd) / Math.LN10).toFixed(4),
          lR1dn: +(lplF + (resMean - resStd) / Math.LN10).toFixed(4),
          lR2dn: +(lplF + (resMean - 2 * resStd) / Math.LN10).toFixed(4),
        });
      }

      // Sigma chart
      const sigmaChart = prices.map((p, i) => {
        if (i % 5 !== 0 && i !== prices.length - 1) return null;
        const t = daysSinceGenesis(p.date); const plV = plPrice(a, b, t);
        const res = Math.log(p.price) - Math.log(plV);
        return { date: p.date.slice(0, 7), sigma: +((res - resMean) / resStd).toFixed(3) };
      }).filter(Boolean);

      setMsg("Running 500 Monte Carlo simulations (3Y)...");
      await new Promise(r => setTimeout(r, 30));
      const N3Y = 365 * 3;
      let paths3y = [];
      for (let batch = 0; batch < 5; batch++) {
        const chunk = simulatePathsPL(100, N3Y, H, lambda2, resStd, resMean, a, b, t0, ouRegimes, currentResidual, resReturns);
        paths3y = paths3y.concat(chunk);
        setMsg(`Running Monte Carlo... ${(batch + 1) * 100}/500 (3Y)`);
        await new Promise(r => setTimeout(r, 10));
      }
      const percentiles3y = computePercentiles(paths3y, N3Y);

      const plForecast365 = Array.from({ length: 73 }, (_, i) => ({ t: i * 5, pl: +plPrice(a, b, t0 + i * 5).toFixed(0) }));
      const plForecast3y = Array.from({ length: Math.ceil(N3Y / 5) + 1 }, (_, i) => ({ t: i * 5, pl: +plPrice(a, b, t0 + i * 5).toFixed(0) }));

      // Autocorrelation for momentum
      const rrMean = resReturns.reduce((s, x) => s + x, 0) / (resReturns.length || 1);
      const rrVar = resReturns.reduce((s, x) => s + (x - rrMean) ** 2, 0) / (resReturns.length || 1);
      const acLags = [1, 2, 3, 5].map(lag => { const nn = resReturns.length - lag; if (nn < 10) return 0; let cov = 0; for (let i = 0; i < nn; i++) cov += (resReturns[i] - rrMean) * (resReturns[i + lag] - rrMean); return cov / nn / (rrVar || 1); });
      const mom = acLags.reduce((s, x) => s + x, 0) / acLags.length;

      setD({
        H, lambda2, std, mean, skew, kurt, annualVol, S0, t0, n, source, mom,
        isSynthetic: source.includes("Synthetic"),
        lastDate: lastPrice.date, a, b, r2, resMean, resStd, plToday, sigmaFromPL,
        kappa, halfLife, ouRegimes, resReturns, dailyResiduals, currentResidual,
        tauData, plChart, forecastChart, sigmaChart,
        percentiles, plForecast365, percentiles3y, plForecast3y,
        pl1y: +plPrice(a, b, t0 + 365).toFixed(0),
        pl2y: +plPrice(a, b, t0 + 730).toFixed(0),
        pl3y: +plPrice(a, b, t0 + 365 * 3).toFixed(0),
      });
      setPhase("done");
    } catch (e) {
      setMsg(e?.message || "Unexpected error");
      setPhase("error");
    }
  }, []);

  useEffect(() => { run(); }, []);

  // ── LOADING ──
  if (phase === "loading") return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap'); @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}} * { box-sizing: border-box; }`}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>₿</div>
        <div style={{ color: "#9B9A97", fontSize: 14, animation: "pulse 1.5s ease-in-out infinite" }}>{msg}</div>
      </div>
    </div>
  );

  if (phase === "error") return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap'); * { box-sizing: border-box; }`}</style>
      <div>
        <Callout emoji="⚠️" bg="#FFF3E0" border="#E8A838">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Something went wrong</div>
          <div style={{ color: "#9B9A97" }}>{msg}</div>
        </Callout>
        <button onClick={run} style={{ fontFamily: "'DM Sans', sans-serif", background: "#37352F", color: "#FFF", border: "none", padding: "8px 24px", cursor: "pointer", fontSize: 13, borderRadius: 4, fontWeight: 500 }}>Try again</button>
      </div>
    </div>
  );

  // ── Destructure ──
  const { H, lambda2, std, annualVol, skew, kurt, S0, t0, source, isSynthetic, lastDate, mom,
    a, b, r2, resMean, resStd, plToday, sigmaFromPL, kappa, halfLife, ouRegimes,
    resReturns, currentResidual,
    tauData, plChart, forecastChart, sigmaChart,
    percentiles, plForecast365, percentiles3y, plForecast3y,
    pl1y, pl2y, pl3y } = d;

  const last = percentiles[percentiles.length - 1];
  const last3y = percentiles3y[percentiles3y.length - 1];
  const verdict = getVerdictPlain(sigmaFromPL);
  const volInfo = getVolLabel(annualVol);

  const mcP5 = last?.p5 || S0 * 0.5;
  const mcP95 = last?.p95 || S0 * 2;
  const upside = (mcP95 - S0) / S0;
  const downside = Math.max(0, (S0 - mcP5) / S0);
  const deviationPct = ((S0 - plToday) / plToday * 100);

  // ── Actionable metrics ──
  const mcP50 = last?.p50 || S0;
  const udRatio = downside > 0 ? upside / downside : 99;

  // ── PL deterministic: if you buy today, where does the model say you'll be in 1 year ──
  const pl1yFuture = plPrice(a, b, t0 + 365);
  const pl1yReturn = ((pl1yFuture - S0) / S0 * 100);
  const pl1yBands = {
    p2up: Math.exp(Math.log(pl1yFuture) + resMean + 2 * resStd),
    p1up: Math.exp(Math.log(pl1yFuture) + resMean + resStd),
    fair: pl1yFuture,
    p1dn: Math.exp(Math.log(pl1yFuture) + resMean - resStd),
    p2dn: Math.exp(Math.log(pl1yFuture) + resMean - 2 * resStd),
  };
  const plUpside1y = ((pl1yBands.p1up - S0) / S0 * 100);
  const plDownside1y = ((S0 - pl1yBands.p1dn) / S0 * 100);
  const plRR1y = plDownside1y > 0 ? plUpside1y / plDownside1y : 99;
  const plWorstReturn1y = ((pl1yBands.p2dn - S0) / S0 * 100);
  const plBestReturn1y = ((pl1yBands.p2up - S0) / S0 * 100);

  // ── MC probabilistic: actual loss probability from simulated paths ──
  function mcLossProb(pcts, day, spotPrice) {
    const idx = Math.min(Math.floor(day / 5), pcts.length - 1);
    const row = pcts[idx];
    if (!row) return null;
    const knownPcts = [
      { price: row.p5, prob: 5 },
      { price: row.p25, prob: 25 },
      { price: row.p50, prob: 50 },
      { price: row.p75, prob: 75 },
      { price: row.p95, prob: 95 },
    ];
    if (spotPrice <= knownPcts[0].price) return 2.5;
    if (spotPrice >= knownPcts[4].price) return 97.5;
    for (let i = 0; i < knownPcts.length - 1; i++) {
      if (spotPrice >= knownPcts[i].price && spotPrice <= knownPcts[i + 1].price) {
        const t = (spotPrice - knownPcts[i].price) / (knownPcts[i + 1].price - knownPcts[i].price);
        return knownPcts[i].prob + t * (knownPcts[i + 1].prob - knownPcts[i].prob);
      }
    }
    return 50;
  }

  const mcLossHorizons = [
    { label: "1 month", days: 30, pcts: percentiles },
    { label: "3 months", days: 90, pcts: percentiles },
    { label: "6 months", days: 182, pcts: percentiles },
    { label: "1 year", days: 365, pcts: percentiles },
    { label: "3 years", days: 1095, pcts: percentiles3y },
  ].map(h => {
    const pLoss = mcLossProb(h.pcts, h.days, S0);
    const idx = Math.min(Math.floor(h.days / 5), h.pcts.length - 1);
    const row = h.pcts[idx] || {};
    return { label: h.label, days: h.days, pLoss, p50: row.p50, p5: row.p5, p95: row.p95 };
  });

  // PL forward projections at multiple horizons
  const plForwardHorizons = [
    { label: "1 month", days: 30 },
    { label: "3 months", days: 90 },
    { label: "6 months", days: 182 },
    { label: "1 year", days: 365 },
    { label: "3 years", days: 1095 },
  ].map(h => {
    const plF = plPrice(a, b, t0 + h.days);
    const implRet = ((plF - S0) / S0 * 100);
    const p2up = Math.exp(Math.log(plF) + resMean + 2 * resStd);
    const p1up = Math.exp(Math.log(plF) + resMean + resStd);
    const p1dn = Math.exp(Math.log(plF) + resMean - resStd);
    const p2dn = Math.exp(Math.log(plF) + resMean - 2 * resStd);
    return { ...h, plF, implRet, p2up, p1up, p1dn, p2dn };
  });

  // Market temperature: composite of sigma + vol + momentum
  function getMarketTemp(sig, annVol, mom) {
    let score = 0;
    score += Math.abs(sig) > 1.8 ? 3 : Math.abs(sig) > 1.0 ? 2 : Math.abs(sig) > 0.5 ? 1 : 0;
    score += annVol > 1.2 ? 3 : annVol > 0.8 ? 2 : annVol > 0.45 ? 1 : 0;
    score += Math.abs(mom) > 0.1 ? 2 : Math.abs(mom) > 0.05 ? 1 : 0;
    if (score <= 1) return { emoji: "🧊", label: "Calm", color: "#2F80ED", desc: "Low activity, stable conditions" };
    if (score <= 3) return { emoji: "🌤", label: "Normal", color: "#27AE60", desc: "Typical market dynamics" };
    if (score <= 5) return { emoji: "🔥", label: "Hot", color: "#F2994A", desc: "Elevated activity, be attentive" };
    return { emoji: "🌋", label: "Overheated", color: "#EB5757", desc: "Extreme conditions, high caution" };
  }
  const temp = getMarketTemp(sigmaFromPL, annualVol, mom);

  // Scenarios (must be computed before verdict)
  const sig = sigmaFromPL;
  let s1;
  if (sig < -1.5) s1 = [0.07, 0.27, 0.13, 0.48, 0.05];
  else if (sig < -0.5) s1 = [0.13, 0.20, 0.20, 0.40, 0.07];
  else if (sig < 0.3) s1 = [0.20, 0.18, 0.32, 0.20, 0.10];
  else if (sig < 1.2) s1 = [0.30, 0.17, 0.18, 0.10, 0.25];
  else s1 = [0.45, 0.20, 0.10, 0.05, 0.20];
  { const t = s1.reduce((a, b) => a + b, 0); s1 = s1.map(v => v / t); }

  let s2;
  if (mom < -0.08) s2 = [0.34, 0.26, 0.20, 0.14, 0.06];
  else if (mom < 0.02) s2 = [0.20, 0.20, 0.32, 0.20, 0.08];
  else if (mom < 0.08) s2 = [0.13, 0.15, 0.24, 0.36, 0.12];
  else s2 = [0.05, 0.09, 0.13, 0.35, 0.38];
  { const t = s2.reduce((a, b) => a + b, 0); s2 = s2.map(v => v / t); }

  const scenarioWeights = [0.55, 0.45];
  const sigs2 = [s1, s2];
  const rawProbs = [0, 1, 2, 3, 4].map(sc => sigs2.reduce((sum, sv, si) => sum + scenarioWeights[si] * sv[sc], 0));
  const totalProb = rawProbs.reduce((a, b) => a + b, 0);
  const probs = rawProbs.map(v => Math.round(v / totalProb * 100));
  const diffP = 100 - probs.reduce((a, b) => a + b, 0);
  probs[probs.indexOf(Math.max(...probs))] += diffP;

  const scenarios = [
    { emoji: "📉", label: "Further decline", prob: probs[0], color: "#EB5757" },
    { emoji: "↗️", label: "Technical bounce", prob: probs[1], color: "#E8A838" },
    { emoji: "➡️", label: "Sideways range", prob: probs[2], color: "#9B9A97" },
    { emoji: "📈", label: "Bullish reversal", prob: probs[3], color: "#27AE60" },
    { emoji: "🚀", label: "Strong rally", prob: probs[4], color: "#6FCF97" },
  ];
  const bullProb30d = probs[3] + probs[4];
  const bearProb30d = probs[0];

  // Regime detection
  const momDir = mom > 0.05 ? "Persistent" : mom < -0.05 ? "Reversing" : "Neutral";
  const bullConds = [sig > 0.5, sig > 1.0, mom > 0.08, mom > 0.12, H > 0.58, H > 0.65, annualVol >= 0.45].filter(Boolean).length;
  const bearConds = [sig < -0.8, sig < -1.2, mom < -0.06, mom < -0.10, H > 0.60, annualVol >= 0.80, halfLife > 120].filter(Boolean).length;
  const rangeConds = [Math.abs(sig) < 0.4, Math.abs(sig) < 0.2, Math.abs(mom) < 0.05, Math.abs(mom) < 0.03, H < 0.58, lambda2 < 0.12, annualVol < 0.45].filter(Boolean).length;
  const accumConds = [sig < -1.0, sig < -1.5, mom > -0.04, H < 0.62, annualVol < 0.80, halfLife < 200, lambda2 < 0.20].filter(Boolean).length;
  const recovConds = [sig < 0.2, mom > 0.04, mom > 0.08, H > 0.55, annualVol < 0.80, sig > -1.0, halfLife < 180].filter(Boolean).length;
  const regimes = [
    { id: "bear", emoji: "🐻", label: "Bear Market", score: bearConds, color: "#EB5757", desc: "Sustained downward pressure" },
    { id: "range", emoji: "↔️", label: "Ranging", score: rangeConds, color: "#9B9A97", desc: "Sideways consolidation" },
    { id: "accum", emoji: "🎯", label: "Accumulation", score: accumConds, color: "#2F80ED", desc: "Smart money buying" },
    { id: "recov", emoji: "🌱", label: "Recovery", score: recovConds, color: "#27AE60", desc: "Early uptrend forming" },
    { id: "bull", emoji: "🚀", label: "Bull Run", score: bullConds, color: "#6FCF97", desc: "Strong upward momentum" },
  ];
  const domRegime = regimes.reduce((a, b) => a.score > b.score ? a : b);

  // ── "Should I buy?" — COMPOSITE SCORING ──
  function generateVerdict() {
    const loss1y = mcLossHorizons.find(h => h.days === 365);
    const loss3y = mcLossHorizons.find(h => h.days === 1095);
    const mc1yMedian = loss1y?.p50 ? ((loss1y.p50 - S0) / S0 * 100) : 0;
    const mc3yMedian = loss3y?.p50 ? ((loss3y.p50 - S0) / S0 * 100) : 0;
    const pl3yFuture = plPrice(a, b, t0 + 1095);
    const pl3yReturn = ((pl3yFuture - S0) / S0 * 100);
    const l1y = loss1y?.pLoss || 50;
    const l3y = loss3y?.pLoss || 50;

    // ── Signal scoring: each signal contributes [-1, +1] ──
    // 1. PL Deviation (weight: 25%) — where we are vs fair value
    const sigScore = sig > 1.8 ? -1 : sig > 1.0 ? -0.6 : sig > 0.5 ? -0.2 : sig > -0.5 ? 0.3 : sig > -1.0 ? 0.6 : sig > -1.5 ? 0.8 : 1.0;

    // 2. MC Risk/Reward (weight: 20%) — asymmetry from simulations
    const rrScore = udRatio >= 5 ? 1 : udRatio >= 3 ? 0.7 : udRatio >= 2 ? 0.4 : udRatio >= 1.5 ? 0.2 : udRatio >= 1 ? 0 : -0.5;

    // 3. MC Loss probability 1Y (weight: 15%) — direct risk measure
    const lossScore = l1y < 5 ? 1 : l1y < 10 ? 0.7 : l1y < 20 ? 0.3 : l1y < 35 ? 0 : l1y < 50 ? -0.4 : -0.8;

    // 4. 30-day outlook (weight: 15%) — short-term trajectory
    const outlookScore = bullProb30d > 60 ? 0.8 : bullProb30d > 45 ? 0.4 : bullProb30d > 30 ? 0 : bearProb30d > 40 ? -0.6 : -0.3;

    // 5. Market regime (weight: 12%) — cycle position
    const regimeMap = { bull: 0.8, recov: 0.6, accum: 0.4, range: 0, bear: -0.7 };
    const regimeScore = regimeMap[domRegime.id] || 0;

    // 6. Market temperature (weight: 8%) — environment quality
    const tempMap = { Calm: 0.3, Normal: 0.1, Hot: -0.3, Overheated: -0.7 };
    const tempScore = tempMap[temp.label] || 0;

    // 7. Hurst persistence (weight: 5%) — trend reliability
    const hurstScore = H > 0.65 ? (sig < 0 ? 0.4 : -0.2) : H > 0.55 ? 0.1 : -0.1;

    // Weighted composite
    const composite = (
      sigScore * 0.25 +
      rrScore * 0.20 +
      lossScore * 0.15 +
      outlookScore * 0.15 +
      regimeScore * 0.12 +
      tempScore * 0.08 +
      hurstScore * 0.05
    );

    // Map composite to verdict
    let answer, answerColor, answerSub, confidence;
    if (composite > 0.5) {
      answer = "YES"; answerColor = "#27AE60"; confidence = "high";
      answerSub = composite > 0.75 ? "Strong buy signal across all indicators." : "Most signals align favorably.";
    } else if (composite > 0.2) {
      answer = "YES"; answerColor = "#27AE60"; confidence = "moderate";
      answerSub = "The balance of signals leans positive.";
    } else if (composite > -0.1) {
      answer = "CAUTIOUSLY"; answerColor = "#F2994A"; confidence = "low";
      answerSub = "Mixed signals. Small position or wait for a better setup.";
    } else if (composite > -0.35) {
      answer = "NOT NOW"; answerColor = "#EB5757"; confidence = "moderate";
      answerSub = "More signals point to risk than opportunity right now.";
    } else {
      answer = "NOT NOW"; answerColor = "#EB5757"; confidence = "high";
      answerSub = "Multiple indicators suggest waiting for a correction.";
    }

    // Signal breakdown for transparency
    const signals = [
      { name: "Valuation (PL)", score: sigScore, weight: 25, detail: sig > 0.5 ? `${Math.abs(deviationPct).toFixed(0)}% above fair value` : sig > -0.5 ? "Near fair value" : `${Math.abs(deviationPct).toFixed(0)}% below fair value` },
      { name: "Risk/Reward (MC)", score: rrScore, weight: 20, detail: udRatio >= 99 ? "All scenarios profitable" : `${udRatio.toFixed(1)}x upside vs downside` },
      { name: "Loss prob. 1Y (MC)", score: lossScore, weight: 15, detail: `${l1y.toFixed(0)}% chance of loss` },
      { name: "30-day outlook", score: outlookScore, weight: 15, detail: `${bullProb30d}% bullish, ${bearProb30d}% bearish` },
      { name: "Market regime", score: regimeScore, weight: 12, detail: `${domRegime.label} (${domRegime.score}/7)` },
      { name: "Temperature", score: tempScore, weight: 8, detail: temp.label },
      { name: "Trend (Hurst)", score: hurstScore, weight: 5, detail: `H=${H.toFixed(2)} — ${H > 0.6 ? "persistent" : "weak"}` },
    ];

    // Explanation paragraphs
    const paras = [];

    // Situation + valuation
    if (sig > 1.8) {
      paras.push(`Bitcoin at ${fmtK(S0)} is ${Math.abs(deviationPct).toFixed(0)}% above its long-term fair value of ${fmtK(plToday)}. Historically, when it gets this stretched, corrections follow.`);
    } else if (sig > 0.8) {
      paras.push(`Bitcoin at ${fmtK(S0)} is running about ${Math.abs(deviationPct).toFixed(0)}% above fair value (${fmtK(plToday)}). Not in bubble territory yet, but you're paying a premium.`);
    } else if (sig > -0.5) {
      paras.push(`Bitcoin at ${fmtK(S0)} is ${Math.abs(deviationPct).toFixed(0)}% ${deviationPct >= 0 ? "above" : "below"} the model's fair value of ${fmtK(plToday)}. That's right in the normal range — a fair price.`);
    } else {
      paras.push(`Bitcoin at ${fmtK(S0)} is ${Math.abs(deviationPct).toFixed(0)}% below the model's fair value of ${fmtK(plToday)}. These are the entries people look back on and wish they'd sized up.`);
    }

    // PL + MC projections
    paras.push(`The Power Law puts fair value at ${fmtK(pl1yFuture)} in 1 year (${pl1yReturn >= 0 ? "+" : ""}${pl1yReturn.toFixed(0)}%) and ${fmtK(pl3yFuture)} in 3 years (${pl3yReturn >= 0 ? "+" : ""}${pl3yReturn.toFixed(0)}%). The Monte Carlo median is ${mc1yMedian >= 0 ? "+" : ""}${mc1yMedian.toFixed(0)}% at 1 year and ${mc3yMedian >= 0 ? "+" : ""}${mc3yMedian.toFixed(0)}% at 3 years.`);

    // Worst case
    const mcWorst1y = loss1y?.p5 ? ((loss1y.p5 - S0) / S0 * 100) : -50;
    const mcWorst3y = loss3y?.p5 ? ((loss3y.p5 - S0) / S0 * 100) : -30;
    paras.push(`Worst case: the PL's −2σ floor in 1 year is ${fmtK(pl1yBands.p2dn)} (${plWorstReturn1y >= 0 ? "+" : ""}${plWorstReturn1y.toFixed(0)}%). The MC bottom 5% of paths: ${fmtK(loss1y?.p5 || S0 * 0.5)} (${mcWorst1y.toFixed(0)}%) in 1 year, ${fmtK(loss3y?.p5 || S0 * 0.5)} (${mcWorst3y >= 0 ? "+" : ""}${mcWorst3y.toFixed(0)}%) in 3 years.${mcWorst3y > 0 ? " Even the worst-case simulation is in profit at 3 years." : ""}`);

    // Short-term + regime + environment
    const regimeNote = domRegime.id === "bull" ? "in a bull run" : domRegime.id === "bear" ? "in a bear market" : domRegime.id === "accum" ? "in an accumulation phase" : domRegime.id === "recov" ? "in early recovery" : "in a ranging market";
    paras.push(`Short-term: the 30-day outlook gives a ${bullProb30d}% probability of bullish action vs ${bearProb30d}% bearish. The market is ${regimeNote}, with ${temp.label.toLowerCase()} conditions. ${H > 0.6 ? "Trends are persistent right now (H=" + H.toFixed(2) + "), so current direction has momentum." : "Trend persistence is weak, so reversals are more likely than continuation."}`);

    // Probabilities
    paras.push(`Your probability of being at a loss after 1 year: ~${l1y.toFixed(0)}%. At 3 years: ~${l3y.toFixed(0)}%.${l3y < 5 ? " Time solves everything at these levels." : l3y < 15 ? " The longer you hold, the better the odds." : ""}`);

    return { answer, answerColor, answerSub, composite, confidence, signals, paras };
  }

  const buyVerdict = generateVerdict();

  // Risk matrix data
  const riskLevels = [5, 10, 25, 50, 75, 90, 95];

  const plMatrixRows = riskLevels.map(rl => {
    const z = normInv(rl / 100);
    return { rl, price: Math.exp(Math.log(plToday) + resMean + z * resStd) };
  });
  const mcMatrixRows = riskLevels.map(rl => {
    const pts = [{ p: 5, v: last.p5 }, { p: 25, v: last.p25 }, { p: 50, v: last.p50 }, { p: 75, v: last.p75 }, { p: 95, v: last.p95 }];
    let lo = pts[0], hi = pts[pts.length - 1];
    for (let i = 0; i < pts.length - 1; i++) { if (rl >= pts[i].p && rl <= pts[i + 1].p) { lo = pts[i]; hi = pts[i + 1]; break; } }
    const t = lo.p === hi.p ? 0 : (rl - lo.p) / (hi.p - lo.p);
    return { rl, price: lo.v + t * (hi.v - lo.v) };
  });

  // Key levels
  const levels = [
    { label: "Bubble territory", price: +Math.exp(Math.log(plToday) + resMean + 2 * resStd).toFixed(0), color: "#EB5757", sigma: "+2σ" },
    { label: "Cycle ceiling", price: +Math.exp(Math.log(plToday) + resMean + resStd).toFixed(0), color: "#F2994A", sigma: "+1σ" },
    { label: "Fair value (Power Law)", price: plToday, color: "#27AE60", sigma: "0" },
    { label: "Normal correction floor", price: +Math.exp(Math.log(plToday) + resMean - resStd).toFixed(0), color: "#2F80ED", sigma: "−1σ" },
    { label: "Deep accumulation zone", price: +Math.exp(Math.log(plToday) + resMean - 2 * resStd).toFixed(0), color: "#56CCF2", sigma: "−2σ" },
  ];

  // PL chart
  const allPLData = [...plChart, ...forecastChart.map(p => ({ ...p, forecast: true }))];
  const rangeStart = { "2010": "2010-01-01", "2017": "2017-01-01", "2020": "2020-01-01", "2024": "2024-01-01", "all": "1900-01-01" }[plRange] || "2020-01-01";
  const allFiltered = allPLData.filter(p => p.date >= rangeStart);
  // Sample for chart performance: all=every 7d, 2010/2017=every 3d, 2020+=every 2d, 2024+=every day
  const sampleRate = { "all": 7, "2010": 3, "2017": 3, "2020": 2, "2024": 1 }[plRange] || 2;
  const filteredPL = allFiltered.filter((_, i) => i % sampleRate === 0 || i === allFiltered.length - 1);
  const allVals = filteredPL.flatMap(p => [p.lR2up, p.lR1up, p.lPl, p.lR1dn, p.lR2dn, p.lPrice].filter(v => v != null && isFinite(v)));
  const autoMin = allVals.length ? Math.floor(Math.min(...allVals) * 2) / 2 : 3;
  const autoMax = allVals.length ? Math.ceil(Math.max(...allVals) * 2) / 2 + 0.5 : 7;
  const yTicks = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(t => t >= autoMin - 0.3 && t <= autoMax + 0.3);

  // X-axis: log₁₀(days since genesis) — makes the Power Law a straight line
  const logTVals = filteredPL.map(p => p.logT).filter(v => v != null && isFinite(v));
  const logTMin = logTVals.length ? Math.floor(Math.min(...logTVals) * 10) / 10 : 2.5;
  const logTMax = logTVals.length ? Math.ceil(Math.max(...logTVals) * 10) / 10 : 4.1;
  // Generate year-labeled ticks for the log-time axis
  const yearTicks = [2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026, 2028, 2030, 2035, 2039]
    .map(y => +Math.log10(daysSinceGenesis(`${y}-01-01`)).toFixed(4))
    .filter(lt => lt >= logTMin - 0.02 && lt <= logTMax + 0.02);
  const fmtLogT = v => {
    const days = Math.pow(10, v);
    const date = new Date(new Date("2009-01-03").getTime() + days * 86400000);
    return date.getFullYear().toString();
  };
  const lastLogT = plChart.length ? plChart[plChart.length - 1].logT : null;

  return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh", color: "#37352F", fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #FFFFFF; }
        @keyframes livepulse { 0%,100%{ opacity:1; } 50%{ opacity:0.3; } }
        a:hover { opacity: 0.7; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #E8E5E0; border-radius: 3px; }

        .mmar-page { max-width: 860px; margin: 0 auto; padding: 24px 16px 60px; }
        .mmar-title { font-size: 28px; font-weight: 700; margin: 0; letter-spacing: -0.03em; line-height: 1.2; }
        .grid-hero { display: grid; grid-template-columns: 1fr; gap: 20px; padding: 20px 0; align-items: start; }
        .hero-price { font-size: 36px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; margin-bottom: 4px; }
        .grid-updown { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 4px; }
        .grid-regime { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #E8E5E0; border-radius: 8px; overflow: hidden; margin-top: 12px; }
        .grid-signals { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 16px; }
        .grid-mc-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }
        .grid-params { display: grid; grid-template-columns: 1fr; gap: 1px; background: #E8E5E0; border: 1px solid #E8E5E0; border-radius: 8px; overflow: hidden; }
        .grid-footer { grid-template-columns: 1fr; }
        .chart-container { height: 280px; }
        .chart-container-sm { height: 180px; }
        .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .table-scroll table { min-width: 480px; }
        .legend-row { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
        .toggle-content { padding-left: 0; padding-bottom: 16px; }

        @media (min-width: 640px) {
          .mmar-page { padding: 32px 24px 80px; }
          .mmar-title { font-size: 36px; }
          .grid-hero { grid-template-columns: 1fr 1fr; gap: 32px; padding: 24px 0; }
          .hero-price { font-size: 48px; }
          .grid-regime { grid-template-columns: repeat(5, 1fr); }
          .grid-signals { grid-template-columns: repeat(3, 1fr); gap: 16px; }
          .grid-mc-stats { grid-template-columns: repeat(4, 1fr); gap: 16px; }
          .grid-params { grid-template-columns: repeat(3, 1fr); }
          .grid-footer { grid-template-columns: 1fr 1fr; }
          .chart-container { height: 400px; }
          .chart-container-sm { height: 220px; }
          .legend-row { gap: 16px; }
          .toggle-content { padding-left: 28px; }
        }
      `}</style>

      {/* ═══ PAGE ═══ */}
      <div className="mmar-page">

        {/* ═══ PAGE TITLE ═══ */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#27AE60", animation: "livepulse 2s ease-in-out infinite" }} />
              <span style={{ fontSize: 11, color: "#27AE60", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Live analysis</span>
              <span style={{ fontSize: 11, color: "#BFBFBA" }}>· {fmtK(S0)} · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            </div>
            <button onClick={() => supabase.auth.signOut()} style={{ background: "none", border: "none", fontSize: 11, color: "#BFBFBA", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Sign out</button>
          </div>
          <h1 className="mmar-title">
            Should I buy Bitcoin today?
          </h1>
          <p style={{ fontSize: 14, color: "#9B9A97", margin: "6px 0 0", lineHeight: 1.5 }}>
            A quantitative answer based on 15 years of data, fractal math, and 500 simulated futures.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#BFBFBA" }}>
              Built by <a href="https://www.commonsense.finance/" target="_blank" rel="noopener noreferrer" style={{ color: "#9B9A97", fontWeight: 600, textDecoration: "none", borderBottom: "1px dotted #BFBFBA" }}>CommonSense</a> & <a href="https://www.linkedin.com/in/eduforte/" target="_blank" rel="noopener noreferrer" style={{ color: "#9B9A97", fontWeight: 600, textDecoration: "none", borderBottom: "1px dotted #BFBFBA" }}>Edu Forte</a> · {source}{refreshing ? " · updating..." : lastRefresh ? ` · refreshed ${lastRefresh.toLocaleTimeString()}` : ""}
            </span>
          </div>
        </div>

        <Divider />

        {isSynthetic && (
          <Callout emoji="⚠️" bg="#FFF8E7" border="#E8A838">
            <span style={{ fontWeight: 600 }}>Using synthetic data.</span> Live APIs unavailable. Deploy with Binance/Kraken access for real-time pricing.
          </Callout>
        )}

        {/* ═══ THE SHORT ANSWER ═══ */}
        <div style={{ marginTop: 4 }}>
          <Toggle label="💬 The short answer" open={openSections.shouldbuy} onToggle={() => toggleSection("shouldbuy")}>

            {/* YES / NO */}
            <div style={{ padding: "24px 0 20px", textAlign: "center" }}>
              <div style={{ fontSize: 52, fontWeight: 800, color: buyVerdict.answerColor, letterSpacing: "-0.03em", lineHeight: 1, fontFamily: "'DM Sans', sans-serif" }}>
                {buyVerdict.answer}
              </div>
              <div style={{ fontSize: 14, color: "#6B6B6B", marginTop: 10 }}>
                {buyVerdict.answerSub}
              </div>
              <div style={{ fontSize: 11, color: "#BFBFBA", marginTop: 6 }}>
                Composite score: {(buyVerdict.composite * 100).toFixed(0)}/100 · Confidence: {buyVerdict.confidence}
              </div>
            </div>

            {/* Signal breakdown */}
            <Toggle label="What's driving this" open={openSections.drivers} onToggle={() => toggleSection("drivers")} count={`${(buyVerdict.composite * 100).toFixed(0)}/100`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {buyVerdict.signals.map(s => {
                  const barColor = s.score > 0.3 ? "#27AE60" : s.score > 0 ? "#6FCF97" : s.score > -0.3 ? "#F2994A" : "#EB5757";
                  const barWidth = Math.abs(s.score) * 50;
                  const isPositive = s.score >= 0;
                  return (
                    <div key={s.name}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                        <div>
                          <span style={{ fontSize: 12, color: "#37352F", fontWeight: 500 }}>{s.name}</span>
                          <span style={{ fontSize: 10, color: "#BFBFBA", marginLeft: 6 }}>{s.weight}%</span>
                        </div>
                        <span style={{ fontSize: 11, color: "#9B9A97" }}>{s.detail}</span>
                      </div>
                      <div style={{ position: "relative", height: 6, background: "#E8E5E0", borderRadius: 3 }}>
                        <div style={{ position: "absolute", top: 0, height: "100%", borderRadius: 3, background: barColor, ...(isPositive ? { left: "50%", width: `${barWidth}%` } : { right: "50%", width: `${barWidth}%` }) }} />
                        <div style={{ position: "absolute", top: -2, left: "calc(50% - 1px)", width: 2, height: 10, background: "#BFBFBA" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: "#BFBFBA", marginTop: 10 }}>
                Each bar shows the signal's contribution (right = bullish, left = bearish)
              </div>
            </Toggle>

          </Toggle>
        </div>

        <Divider />

        {/* ═══ THE LONG ANSWER ═══ */}
        <div style={{ marginTop: 4 }}>
          <Toggle label="📖 The long answer" open={openSections.longanswer} onToggle={() => toggleSection("longanswer")}>

            {/* YES / NO (repeated for context) */}
            <div style={{ padding: "16px 0 16px", textAlign: "center", marginBottom: 12, borderBottom: "1px solid #E8E5E0" }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: buyVerdict.answerColor, letterSpacing: "-0.03em", lineHeight: 1, fontFamily: "'DM Sans', sans-serif" }}>
                {buyVerdict.answer}
              </div>
              <div style={{ fontSize: 13, color: "#6B6B6B", marginTop: 8 }}>
                {buyVerdict.answerSub}
              </div>
            </div>

            {/* Narrative */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {buyVerdict.paras.map((para, i) => (
                <p key={i} style={{ fontSize: 14, lineHeight: 1.7, color: "#37352F", margin: 0 }}>{para}</p>
              ))}
            </div>
            <p style={{ fontSize: 11, color: "#BFBFBA", marginTop: 18, lineHeight: 1.5, fontStyle: "italic" }}>
              Generated dynamically from quantitative models (Power Law + MMAR + Monte Carlo). It's math, not prophecy. Never invest more than you can afford to lose.
            </p>

          </Toggle>
        </div>

        <Divider />

        {/* ═══ THE DATA ═══ */}
        <div style={{ marginTop: 4 }}>
          <Toggle label="Live snapshot" open={openSections.dataview} onToggle={() => toggleSection("dataview")} count="live">

            {/* Price + Gauge */}
            <div style={{ background: "#FAFAF8", borderRadius: 8, border: "1px solid #E8E5E0", padding: "20px 20px", marginBottom: 12 }}>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "#9B9A97", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Current Price</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span className="hero-price">{fmtK(S0)}</span>
                  <span style={{ fontSize: 14, color: "#9B9A97" }}>
                    {deviationPct >= 0 ? `${deviationPct.toFixed(0)}% above` : `${Math.abs(deviationPct).toFixed(0)}% below`} fair value ({fmtK(plToday)})
                  </span>
                </div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <DeviationGauge sigma={sigmaFromPL} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                <Callout emoji={verdict.emoji} bg={`${verdict.color}10`} border={verdict.color}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: verdict.color, marginBottom: 4 }}>{verdict.label}</div>
                  <div style={{ fontSize: 13, color: "#4F4F4F", lineHeight: 1.5 }}>{verdict.desc}</div>
                </Callout>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ padding: "12px 14px", background: "#FFF", borderRadius: 6, border: "1px solid #F1F1EF" }}>
                    <div style={{ fontSize: 11, color: "#9B9A97", marginBottom: 6 }}>Risk / Reward (1Y)</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: udRatio >= 2 ? "#27AE60" : udRatio >= 1 ? "#F2994A" : "#EB5757", fontFamily: "'DM Mono', monospace" }}>
                      {udRatio >= 99 ? "∞" : `${udRatio.toFixed(1)}x`}
                    </div>
                    <div style={{ fontSize: 11, color: "#BFBFBA", marginTop: 2 }}>{udRatio >= 2 ? "Favorable asymmetry" : udRatio >= 1 ? "Balanced" : "Unfavorable"}</div>
                  </div>
                  <div style={{ padding: "12px 14px", background: "#FFF", borderRadius: 6, border: "1px solid #F1F1EF" }}>
                    <div style={{ fontSize: 11, color: "#9B9A97", marginBottom: 6 }}>Market temperature</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 20 }}>{temp.emoji}</span>
                      <span style={{ fontSize: 24, fontWeight: 700, color: temp.color }}>{temp.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#BFBFBA", marginTop: 2 }}>{temp.desc}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* PL 1Y */}
            <div style={{ background: "#FAFAF8", borderRadius: 8, padding: "16px 18px", border: "1px solid #E8E5E0", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 14 }}>📐</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#9B9A97", textTransform: "uppercase", letterSpacing: "0.06em" }}>Power Law — 1 Year Forward</span>
              </div>
              <div style={{ fontSize: 12, color: "#9B9A97", marginBottom: 14, lineHeight: 1.5 }}>
                Where the structural model places Bitcoin in 1 year. No simulation — just the long-term trajectory and its historical deviation bands.
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: "#9B9A97" }}>Fair value in 1Y:</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: pl1yReturn >= 0 ? "#27AE60" : "#EB5757", fontFamily: "'DM Mono', monospace" }}>{fmtK(pl1yFuture)}</span>
                <span style={{ fontSize: 14, color: pl1yReturn >= 0 ? "#27AE60" : "#EB5757", fontWeight: 600 }}>({pl1yReturn >= 0 ? "+" : ""}{pl1yReturn.toFixed(0)}%)</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 14 }}>
                {[
                  { label: "Best case (+2σ)", price: pl1yBands.p2up, color: "#EB5757" },
                  { label: "Ceiling (+1σ)", price: pl1yBands.p1up, color: "#F2994A" },
                  { label: "Fair value", price: pl1yBands.fair, color: "#27AE60" },
                  { label: "Support (−1σ)", price: pl1yBands.p1dn, color: "#2F80ED" },
                  { label: "Worst case (−2σ)", price: pl1yBands.p2dn, color: "#56CCF2" },
                ].map(({ label, price, color }, i) => {
                  const pct = ((price - S0) / S0 * 100);
                  return (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < 4 ? "1px solid #F1F1EF" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Dot color={color} size={7} />
                        <span style={{ fontSize: 12, color: "#6B6B6B" }}>{label}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#37352F" }}>{fmtK(price)}</span>
                        <span style={{ fontSize: 11, color: pct >= 0 ? "#27AE60" : "#EB5757", fontWeight: 500 }}>{pct >= 0 ? "+" : ""}{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, padding: "12px 14px", background: "#FFF", borderRadius: 6, border: "1px solid #F1F1EF" }}>
                <div>
                  <div style={{ fontSize: 10, color: "#9B9A97", marginBottom: 3 }}>Upside to +1σ</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#27AE60", fontFamily: "'DM Mono', monospace" }}>+{plUpside1y.toFixed(0)}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#9B9A97", marginBottom: 3 }}>Downside to −1σ</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: plDownside1y > 0 ? "#EB5757" : "#27AE60", fontFamily: "'DM Mono', monospace" }}>{plDownside1y > 0 ? `−${plDownside1y.toFixed(0)}%` : `+${Math.abs(plDownside1y).toFixed(0)}%`}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#9B9A97", marginBottom: 3 }}>Risk / Reward</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: plRR1y >= 2 ? "#27AE60" : plRR1y >= 1 ? "#F2994A" : "#EB5757", fontFamily: "'DM Mono', monospace" }}>
                    {plRR1y >= 99 ? "∞" : `${plRR1y.toFixed(1)}x`}
                  </div>
                </div>
              </div>
            </div>

            {/* MC loss probability */}
            <div style={{ background: "#FAFAF8", borderRadius: 8, padding: "16px 18px", border: "1px solid #E8E5E0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 14 }}>🎲</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#9B9A97", textTransform: "uppercase", letterSpacing: "0.06em" }}>Probability of loss — Monte Carlo</span>
              </div>
              <div style={{ fontSize: 12, color: "#9B9A97", marginBottom: 14, lineHeight: 1.5 }}>
                If you buy at {fmtK(S0)} today, what percentage of the 500 simulated paths end below your purchase price at each horizon.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {mcLossHorizons.map((h, i) => {
                  const pLoss = h.pLoss != null ? h.pLoss : 50;
                  const safeColor = pLoss < 10 ? "#27AE60" : pLoss < 30 ? "#F2994A" : "#EB5757";
                  const medianReturn = h.p50 ? ((h.p50 - S0) / S0 * 100) : 0;
                  return (
                    <div key={h.label} style={{ padding: "8px 0", borderBottom: i < mcLossHorizons.length - 1 ? "1px solid #F1F1EF" : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: "#37352F", fontWeight: 500 }}>{h.label}</span>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 11, color: "#9B9A97" }}>loss prob.</span>
                          <span style={{ fontSize: 15, fontWeight: 700, color: safeColor, fontFamily: "'DM Mono', monospace" }}>{pLoss.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ flex: 1, height: 4, background: "#E8E5E0", borderRadius: 2, marginRight: 10 }}>
                          <div style={{ height: "100%", width: `${Math.min(100, pLoss)}%`, background: safeColor, borderRadius: 2, transition: "width 0.5s" }} />
                        </div>
                        <span style={{ fontSize: 10, color: "#9B9A97", whiteSpace: "nowrap" }}>
                          median: {medianReturn >= 0 ? "+" : ""}{medianReturn.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </Toggle>
        </div>

        <Divider />

        {/* ═══ TOGGLE SECTIONS ═══ */}
        <div style={{ marginTop: 20 }}>

          <Toggle label="Power Law Model" open={openSections.powerlaw} onToggle={() => toggleSection("powerlaw")}>
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              Bitcoin's price has followed a power law growth curve since 2010. The bands show historical deviation ranges. When price touches the upper bands, it tends to correct. When it reaches lower bands, it tends to recover.
            </p>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {["2010", "2017", "2020", "2024", "all"].map(r => (
                <button key={r} onClick={() => setPlRange(r)} style={{
                  fontSize: 12, padding: "5px 14px", fontFamily: "'DM Sans', sans-serif",
                  background: plRange === r ? "#37352F" : "#F7F6F3",
                  border: "none",
                  color: plRange === r ? "#FFF" : "#6B6B6B",
                  cursor: "pointer", borderRadius: 4, fontWeight: 500,
                }}>
                  {r === "all" ? "All time" : `${r}+`}
                </button>
              ))}
            </div>
            <div className="legend-row">
              {[
                { color: "#EB5757", label: "Bubble (+2σ)", dash: false },
                { color: "#F2994A", label: "Ceiling (+1σ)", dash: true },
                { color: "#27AE60", label: "Fair Value", dash: false },
                { color: "#2F80ED", label: "Support (−1σ)", dash: true },
                { color: "#56CCF2", label: "Accumulation (−2σ)", dash: false },
                { color: "#37352F", label: "BTC Price", dash: false },
              ].map(({ color, dash, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="16" height="3"><line x1="0" y1="1.5" x2="16" y2="1.5" stroke={color} strokeWidth={2} strokeDasharray={dash ? "4 2" : undefined} /></svg>
                  <span style={{ fontSize: 11, color: "#6B6B6B" }}>{label}</span>
                </div>
              ))}
            </div>
            <div className="chart-container" style={{ background: "#FAFAF8", border: "1px solid #E8E5E0", borderRadius: 8, padding: "16px 10px 6px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredPL} margin={{ top: 8, right: 16, left: 10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F1EF" />
                  <XAxis dataKey="logT" type="number" domain={[logTMin, logTMax]} ticks={yearTicks} tick={{ fill: "#9B9A97", fontSize: 10, fontFamily: "'DM Mono', monospace" }} tickLine={false} tickFormatter={fmtLogT} />
                  <YAxis domain={[autoMin, autoMax]} ticks={yTicks} tick={{ fill: "#9B9A97", fontSize: 10, fontFamily: "'DM Mono', monospace" }} tickLine={false} tickFormatter={fmtY} width={55} />
                  <Tooltip {...tooltipStyle} labelFormatter={(v, payload) => payload?.[0]?.payload?.date || fmtLogT(v)} formatter={(v, n) => [fmtK(Math.pow(10, v)), n]} />
                  {lastLogT && <ReferenceLine x={lastLogT} stroke="#E8E5E0" strokeDasharray="4 2" />}
                  <Line type="monotone" dataKey="lR2up" stroke="#EB5757" strokeWidth={1.2} dot={false} name="Bubble" connectNulls />
                  <Line type="monotone" dataKey="lR1up" stroke="#F2994A" strokeWidth={1.2} strokeDasharray="5 3" dot={false} name="Ceiling" connectNulls />
                  <Line type="monotone" dataKey="lPl" stroke="#27AE60" strokeWidth={2} dot={false} name="Fair Value" connectNulls />
                  <Line type="monotone" dataKey="lR1dn" stroke="#2F80ED" strokeWidth={1.2} strokeDasharray="5 3" dot={false} name="Support" connectNulls />
                  <Line type="monotone" dataKey="lR2dn" stroke="#56CCF2" strokeWidth={1.2} dot={false} name="Accumulation" connectNulls />
                  <Line type="monotone" dataKey="lPrice" stroke="#37352F" strokeWidth={2.5} dot={false} name="BTC" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Toggle>

          <Divider />

          <Toggle label="Historical Deviation from Fair Value" open={openSections.montecarlo} onToggle={() => toggleSection("montecarlo")}>
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              How far Bitcoin has deviated from the Power Law model throughout its history. Extreme positive values preceded corrections, extreme negative values preceded rallies.
            </p>
            <div className="chart-container-sm" style={{ background: "#FAFAF8", border: "1px solid #E8E5E0", borderRadius: 8, padding: "12px 10px 6px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sigmaChart}>
                  <defs>
                    <linearGradient id="gSigma" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F2994A" stopOpacity={0.2} /><stop offset="95%" stopColor="#F2994A" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F1EF" />
                  <XAxis dataKey="date" tick={{ fill: "#9B9A97", fontSize: 9, fontFamily: "'DM Mono', monospace" }} tickLine={false} interval={Math.floor(sigmaChart.length / 8)} />
                  <YAxis tick={{ fill: "#9B9A97", fontSize: 9, fontFamily: "'DM Mono', monospace" }} tickFormatter={v => `${v}σ`} domain={[-3.5, 3.5]} />
                  <Tooltip {...tooltipStyle} formatter={v => [`${v}σ`, "Deviation"]} />
                  <ReferenceLine y={0} stroke="#37352F" strokeWidth={1} />
                  <ReferenceLine y={1} stroke="#E8E5E0" strokeDasharray="4 3" />
                  <ReferenceLine y={-1} stroke="#E8E5E0" strokeDasharray="4 3" />
                  <ReferenceLine y={2} stroke="#F1F1EF" strokeDasharray="3 4" />
                  <ReferenceLine y={-2} stroke="#F1F1EF" strokeDasharray="3 4" />
                  <Area type="monotone" dataKey="sigma" stroke="#F2994A" fill="url(#gSigma)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Toggle>

          <Divider />

          <Toggle label="Key Price Levels" open={openSections.levels} onToggle={() => toggleSection("levels")} count={levels.length}>
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              These are the structurally important price levels derived from the Power Law model. They act as gravitational anchors across market cycles.
            </p>
            <div style={{ border: "1px solid #E8E5E0", borderRadius: 8, overflow: "hidden" }}>
              {levels.map(({ label, price, color, sigma }, i) => {
                const pctFromSpot = ((price - S0) / S0 * 100);
                const isNear = Math.abs(pctFromSpot) < 10;
                return (
                  <div key={label} style={{
                    display: "grid", gridTemplateColumns: "auto 1fr auto auto",
                    alignItems: "center", gap: 10, padding: "12px 12px",
                    background: isNear ? "#FAFAF8" : "#FFF",
                    borderBottom: i < levels.length - 1 ? "1px solid #F1F1EF" : "none",
                  }}>
                    <Dot color={color} size={10} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "#37352F" }}>{label}</div>
                      <div style={{ fontSize: 11, color: "#9B9A97", fontFamily: "'DM Mono', monospace" }}>{sigma}</div>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#37352F", textAlign: "right", fontFamily: "'DM Mono', monospace" }}>{fmtK(price)}</div>
                    <div style={{ fontSize: 12, color: pctFromSpot >= 0 ? "#27AE60" : "#EB5757", textAlign: "right", minWidth: 60 }}>
                      {pctFromSpot >= 0 ? "+" : ""}{pctFromSpot.toFixed(0)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </Toggle>

          <Divider />

          <Toggle label="Power Law — Forward Projections" open={openSections.plforward} onToggle={() => toggleSection("plforward")}>
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              Where the Power Law model places fair value at each horizon, with the full σ-band structure. All percentages are relative to today's price of {fmtK(S0)}.
            </p>
            <div className="table-scroll" style={{ border: "1px solid #E8E5E0", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#FAFAF8" }}>
                    {["Horizon", "−2σ Floor", "−1σ Support", "Fair Value", "+1σ Ceiling", "+2σ Bubble"].map((h, i) => (
                      <th key={h} style={{ padding: "9px 10px", textAlign: i === 0 ? "left" : "right", color: ["", "#56CCF2", "#2F80ED", "#27AE60", "#F2994A", "#EB5757"][i] || "#9B9A97", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #E8E5E0", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plForwardHorizons.map(h => {
                    const fmtCell = (price) => {
                      const pct = ((price - S0) / S0 * 100);
                      return { price, pct };
                    };
                    const cells = [fmtCell(h.p2dn), fmtCell(h.p1dn), fmtCell(h.plF), fmtCell(h.p1up), fmtCell(h.p2up)];
                    const cellColors = ["#56CCF2", "#2F80ED", "#27AE60", "#F2994A", "#EB5757"];
                    return (
                      <tr key={h.label} style={{ borderBottom: "1px solid #F1F1EF" }}>
                        <td style={{ padding: "10px 10px", fontWeight: 500, whiteSpace: "nowrap" }}>{h.label}</td>
                        {cells.map((c, i) => (
                          <td key={i} style={{ padding: "10px 10px", textAlign: "right" }}>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: i === 2 ? 600 : 400 }}>{fmtK(c.price)}</div>
                            <div style={{ fontSize: 10, color: c.pct >= 0 ? cellColors[i] : "#EB5757", marginTop: 1 }}>
                              {c.pct >= 0 ? "+" : ""}{c.pct.toFixed(0)}%
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Toggle>

          <Divider />

          <Toggle label="Monte Carlo Simulation — 1 Year" open={openSections.mc3y} onToggle={() => toggleSection("mc3y")}>
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              500 simulated price paths using the MMAR model. The shaded bands show where price is likely to land. The median (P50) is the base case.
            </p>
            <div className="grid-mc-stats">
              {[
                { label: "Bear case (P5)", value: fmtK(last?.p5), color: "#EB5757" },
                { label: "Base case (P50)", value: fmtK(last?.p50), color: "#37352F" },
                { label: "Bull case (P95)", value: fmtK(last?.p95), color: "#27AE60" },
                { label: "PL target 1Y", value: fmtK(pl1y), color: "#9B9A97" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: "#9B9A97", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'DM Mono', monospace" }}>{value}</div>
                </div>
              ))}
            </div>
            <div className="chart-container" style={{ background: "#FAFAF8", border: "1px solid #E8E5E0", borderRadius: 8, padding: "12px 10px 6px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F1EF" />
                  <XAxis dataKey="t" type="number" domain={[0, 365]} tick={{ fill: "#9B9A97", fontSize: 10, fontFamily: "'DM Mono', monospace" }} label={{ value: "days", fill: "#9B9A97", fontSize: 10, position: "insideBottom", offset: -2 }} allowDuplicatedCategory={false} />
                  <YAxis tick={{ fill: "#9B9A97", fontSize: 10, fontFamily: "'DM Mono', monospace" }} tickFormatter={fmtK} />
                  <Tooltip {...tooltipStyle} formatter={v => [fmtK(v)]} />
                  <Line data={plForecast365} type="monotone" dataKey="pl" stroke="#27AE60" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Power Law" />
                  <Line data={percentiles} type="monotone" dataKey="p95" stroke="#BDBDBD" strokeWidth={1} dot={false} name="P95" />
                  <Line data={percentiles} type="monotone" dataKey="p75" stroke="#E0E0E0" strokeWidth={1} strokeDasharray="5 3" dot={false} name="P75" />
                  <Line data={percentiles} type="monotone" dataKey="p50" stroke="#37352F" strokeWidth={2.5} dot={false} name="P50 (median)" />
                  <Line data={percentiles} type="monotone" dataKey="p25" stroke="#E0E0E0" strokeWidth={1} strokeDasharray="5 3" dot={false} name="P25" />
                  <Line data={percentiles} type="monotone" dataKey="p5" stroke="#BDBDBD" strokeWidth={1} dot={false} name="P5" />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#9B9A97" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Horizon table */}
            <div className="table-scroll" style={{ marginTop: 16, border: "1px solid #E8E5E0", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#FAFAF8" }}>
                    {["Horizon", "PL Target", "Bear (P5)", "Base (P50)", "Bull (P95)"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: h === "Horizon" ? "left" : "right", color: "#9B9A97", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #E8E5E0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Today", days: 0, pcts: percentiles, plV: plToday },
                    { label: "6 months", days: 182, pcts: percentiles, plV: plPrice(a, b, t0 + 182) },
                    { label: "1 year", days: 365, pcts: percentiles, plV: pl1y },
                    { label: "2 years", days: 730, pcts: percentiles3y, plV: pl2y },
                    { label: "3 years", days: 1095, pcts: percentiles3y, plV: pl3y },
                  ].map(({ label, days, pcts, plV }) => {
                    const idx = Math.min(Math.floor(days / 5), pcts.length - 1);
                    const row = days === 0 ? { p5: S0, p50: S0, p95: S0 } : pcts[idx] || {};
                    const isNow = days === 0;
                    return (
                      <tr key={label} style={{ borderBottom: "1px solid #F1F1EF", background: isNow ? "#FAFAF8" : "#FFF" }}>
                        <td style={{ padding: "10px 14px", fontWeight: isNow ? 600 : 400 }}>{label}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "#27AE60", fontFamily: "'DM Mono', monospace" }}>{fmtK(plV)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "#EB5757", fontFamily: "'DM Mono', monospace" }}>{fmtK(row.p5)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>{fmtK(row.p50)}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", color: "#27AE60", fontFamily: "'DM Mono', monospace" }}>{fmtK(row.p95)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Toggle>

          <Divider />

          <Toggle label="Monte Carlo Simulation — 3 Years" open={openSections.mc3y_chart} onToggle={() => toggleSection("mc3y_chart")}>
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              Longer-horizon simulation covering a full cycle. Same 100-path MMAR engine extended to 3 years.
            </p>
            <div className="grid-mc-stats">
              {[
                { label: "Bear case (P5)", value: fmtK(last3y?.p5), color: "#EB5757" },
                { label: "Base case (P50)", value: fmtK(last3y?.p50), color: "#37352F" },
                { label: "Bull case (P95)", value: fmtK(last3y?.p95), color: "#27AE60" },
                { label: "PL target 3Y", value: fmtK(pl3y), color: "#9B9A97" },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: "#9B9A97", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'DM Mono', monospace" }}>{value}</div>
                </div>
              ))}
            </div>
            <div className="chart-container" style={{ background: "#FAFAF8", border: "1px solid #E8E5E0", borderRadius: 8, padding: "12px 10px 6px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F1EF" />
                  <XAxis dataKey="t" type="number" domain={[0, 365 * 3]} tick={{ fill: "#9B9A97", fontSize: 10, fontFamily: "'DM Mono', monospace" }} tickFormatter={v => `${(v / 365).toFixed(1)}y`} allowDuplicatedCategory={false} />
                  <YAxis tick={{ fill: "#9B9A97", fontSize: 10, fontFamily: "'DM Mono', monospace" }} tickFormatter={fmtK} />
                  <Tooltip {...tooltipStyle} formatter={v => [fmtK(v)]} labelFormatter={v => `Day ${v} (~${(v / 365).toFixed(1)}y)`} />
                  <Line data={plForecast3y} type="monotone" dataKey="pl" stroke="#27AE60" strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Power Law" />
                  <Line data={percentiles3y} type="monotone" dataKey="p95" stroke="#BDBDBD" strokeWidth={1} dot={false} name="P95" />
                  <Line data={percentiles3y} type="monotone" dataKey="p75" stroke="#E0E0E0" strokeWidth={1} strokeDasharray="5 3" dot={false} name="P75" />
                  <Line data={percentiles3y} type="monotone" dataKey="p50" stroke="#37352F" strokeWidth={2.5} dot={false} name="P50 (median)" />
                  <Line data={percentiles3y} type="monotone" dataKey="p25" stroke="#E0E0E0" strokeWidth={1} strokeDasharray="5 3" dot={false} name="P25" />
                  <Line data={percentiles3y} type="monotone" dataKey="p5" stroke="#BDBDBD" strokeWidth={1} dot={false} name="P5" />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#9B9A97" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Toggle>

          <Divider />

          <Toggle label="Risk Matrix — PL vs Monte Carlo" open={openSections.riskmatrix} onToggle={() => toggleSection("riskmatrix")}>
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              How the Power Law statistical distribution compares to the Monte Carlo simulation at each percentile. Large differences indicate the simulation captures dynamics the static model misses.
            </p>
            <div className="table-scroll" style={{ border: "1px solid #E8E5E0", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#FAFAF8" }}>
                    {["Percentile", "PL + Historical σ", "Monte Carlo 1Y", "Difference"].map(h => (
                      <th key={h} style={{ padding: "9px 10px", textAlign: h === "Percentile" ? "left" : "right", color: "#9B9A97", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #E8E5E0", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {riskLevels.map((rl, i) => {
                    const plP = plMatrixRows[i].price;
                    const mcP = mcMatrixRows[i].price;
                    const diff = ((mcP - plP) / plP * 100);
                    const isMedian = rl === 50;
                    const isClose = Math.abs(plP - S0) / S0 < 0.05;
                    return (
                      <tr key={rl} style={{ borderBottom: "1px solid #F1F1EF", background: isMedian ? "#FAFAF8" : "#FFF" }}>
                        <td style={{ padding: "9px 14px", fontWeight: isMedian ? 600 : 400, fontFamily: "'DM Mono', monospace", color: rl < 25 ? "#EB5757" : rl > 75 ? "#27AE60" : "#37352F" }}>P{rl}</td>
                        <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: isClose ? "#F2994A" : "#37352F" }}>{fmtK(plP)}</td>
                        <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: isMedian ? 600 : 400 }}>{fmtK(mcP)}</td>
                        <td style={{ padding: "9px 14px", textAlign: "right", fontSize: 12, color: diff >= 0 ? "#27AE60" : "#EB5757" }}>{diff >= 0 ? "+" : ""}{diff.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Toggle>

          <Divider />

          <Toggle label="30-Day Outlook" open={openSections.scenarios} onToggle={() => toggleSection("scenarios")} count="probabilities">
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              Based on the current valuation level and momentum signals, these are the estimated probabilities for the next 30 days.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {scenarios.sort((a, b) => b.prob - a.prob).map(sc => (
                <div key={sc.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 18, width: 28, textAlign: "center", flexShrink: 0 }}>{sc.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#37352F" }}>{sc.label}</span>
                      <span style={{ fontSize: 18, fontWeight: 700, color: sc.color, fontFamily: "'DM Mono', monospace" }}>{sc.prob}%</span>
                    </div>
                    <ProgressBar value={sc.prob} color={sc.color} height={5} />
                  </div>
                </div>
              ))}
            </div>
          </Toggle>

          <Divider />

          <Toggle label="Market Regime" open={openSections.regime} onToggle={() => toggleSection("regime")}>
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              The model evaluates 7 conditions per regime to determine the current market phase. The regime with the most conditions met is the dominant one.
            </p>

            {/* Dominant regime callout */}
            <Callout emoji={domRegime.emoji} bg={`${domRegime.color}10`} border={domRegime.color}>
              <div style={{ fontWeight: 700, fontSize: 16, color: domRegime.color, marginBottom: 2 }}>{domRegime.label}</div>
              <div style={{ fontSize: 13, color: "#4F4F4F" }}>{domRegime.desc} — {domRegime.score}/7 conditions met</div>
            </Callout>

            {/* All regimes */}
            <div className="grid-regime">
              {regimes.map(r => {
                const isActive = r.id === domRegime.id;
                return (
                  <div key={r.id} style={{
                    background: isActive ? `${r.color}08` : "#FFF",
                    padding: "14px 10px", textAlign: "center",
                    borderTop: isActive ? `3px solid ${r.color}` : "3px solid transparent",
                  }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{r.emoji}</div>
                    <div style={{ fontSize: 10, fontWeight: isActive ? 700 : 500, color: isActive ? r.color : "#9B9A97", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>{r.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: isActive ? r.color : "#BFBFBA", fontFamily: "'DM Mono', monospace" }}>{r.score}<span style={{ fontSize: 11, fontWeight: 400 }}>/7</span></div>
                  </div>
                );
              })}
            </div>

            {/* Supporting signals */}
            <div className="grid-signals">
              <div>
                <div style={{ fontSize: 11, color: "#9B9A97", marginBottom: 4 }}>Momentum</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: mom > 0.05 ? "#27AE60" : mom < -0.05 ? "#EB5757" : "#9B9A97" }}>{momDir}</div>
                <div style={{ fontSize: 11, color: "#BFBFBA", fontFamily: "'DM Mono', monospace" }}>AC: {fmt(mom, 3)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#9B9A97", marginBottom: 4 }}>Volatility regime</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: volInfo.color }}>{volInfo.label}</div>
                <div style={{ fontSize: 11, color: "#BFBFBA" }}>{volInfo.desc}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#9B9A97", marginBottom: 4 }}>Trend persistence</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#37352F" }}>H = {fmt(H, 3)}</div>
                <div style={{ fontSize: 11, color: "#BFBFBA" }}>{H > 0.65 ? "Strong memory" : H > 0.55 ? "Moderate" : "Weak"}</div>
              </div>
            </div>
          </Toggle>

          <Divider />

          <Toggle label="Model Parameters" open={openSections.technicals} onToggle={() => toggleSection("technicals")} count="advanced">
            <p style={{ fontSize: 13, color: "#6B6B6B", lineHeight: 1.6, margin: "0 0 14px" }}>
              Calibrated parameters from the MMAR model with regime-switching OU. These drive the Monte Carlo simulations and scenario analysis above.
            </p>
            <div className="grid-params">
              {[
                { label: "Hurst Exponent (H)", value: fmt(H, 3), desc: H > 0.65 ? "Strong trend persistence (DFA)" : H > 0.55 ? "Moderate persistence (DFA)" : "Weak persistence (DFA)" },
                { label: "Intermittency (λ²)", value: fmt(lambda2, 4), desc: lambda2 > 0.15 ? "Strong vol clustering" : "Moderate clustering" },
                { label: "PL Slope (b)", value: fmt(b, 3), desc: "Growth exponent (WLS)" },
                { label: "Model R²", value: fmt(r2, 4), desc: "Weighted goodness of fit" },
                { label: "Mean-reversion (κ)", value: fmt(kappa, 4), desc: `Blended half-life: ${halfLife}d` },
                { label: "κ calm regime", value: ouRegimes ? fmt(ouRegimes.regimes[0].kappa, 4) : "–", desc: ouRegimes ? `Half-life: ${ouRegimes.halfLifeCalm}d · ${ouRegimes.pCalm}% of time` : "" },
                { label: "κ volatile regime", value: ouRegimes ? fmt(ouRegimes.regimes[1].kappa, 4) : "–", desc: ouRegimes ? `Half-life: ${ouRegimes.halfLifeVol}d · ${100 - ouRegimes.pCalm}% of time` : "" },
                { label: "Current regime", value: ouRegimes ? (ouRegimes.currentRegime === 0 ? "Calm" : "Volatile") : "–", desc: ouRegimes ? `Vol scale: ${ouRegimes.regimes[ouRegimes.currentRegime].volScale.toFixed(2)}x` : "" },
                { label: "Residual σ", value: fmt(resStd, 4), desc: "Deviation amplitude" },
                { label: "Kurtosis", value: fmt(kurt, 2), desc: `Excess: ${fmt(kurt - 3, 2)} (fat tails)` },
                { label: "Skewness", value: fmt(skew, 3), desc: "Tail asymmetry" },
                { label: "Annual Volatility", value: `${(annualVol * 100).toFixed(0)}%`, desc: volInfo.desc },
              ].map(({ label, value, desc }) => (
                <div key={label} style={{ background: "#FFF", padding: "14px 16px" }}>
                  <div style={{ fontSize: 11, color: "#9B9A97", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "'DM Mono', monospace", color: "#37352F" }}>{value}</div>
                  <div style={{ fontSize: 11, color: "#BFBFBA", marginTop: 4 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* ── Burger / Santostasi comparison ── */}
            {(() => {
              const LN10 = Math.log(10);
              const a10 = a / LN10;
              const b10 = b;
              const burgerA = -17.016;
              const burgerB = 5.845;
              const deltaA = ((a10 - burgerA) / Math.abs(burgerA) * 100);
              const deltaB = ((b10 - burgerB) / burgerB * 100);
              const today = daysSinceGenesis(new Date().toISOString().slice(0, 10));
              const ourFV = plPrice(a, b, today);
              const burgerFV = Math.pow(10, burgerA + burgerB * Math.log10(today));
              const fvDelta = ((ourFV - burgerFV) / burgerFV * 100);
              return (
                <div style={{ marginTop: 16, background: "#FAFAF8", borderRadius: 8, border: "1px solid #E8E5E0", padding: "16px 18px" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#9B9A97", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
                    Comparison with Burger / Santostasi (OLS, log₁₀)
                  </div>
                  <div className="table-scroll">
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #E8E5E0" }}>
                          <th style={{ padding: "6px 8px", textAlign: "left", color: "#9B9A97", fontWeight: 500 }}>Parameter</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#9B9A97", fontWeight: 500 }}>Burger (OLS)</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#9B9A97", fontWeight: 500 }}>Ours (WLS)</th>
                          <th style={{ padding: "6px 8px", textAlign: "right", color: "#9B9A97", fontWeight: 500 }}>Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { param: "Intercept (a)", burger: burgerA.toFixed(3), ours: a10.toFixed(3), delta: deltaA },
                          { param: "Slope (b)", burger: burgerB.toFixed(3), ours: b10.toFixed(3), delta: deltaB },
                          { param: "R²", burger: "0.931", ours: fmt(r2, 4), delta: null },
                          { param: "Fair value today", burger: fmtK(burgerFV), ours: fmtK(ourFV), delta: fvDelta },
                        ].map(row => (
                          <tr key={row.param} style={{ borderBottom: "1px solid #F1F1EF" }}>
                            <td style={{ padding: "8px 8px", color: "#37352F", fontWeight: 500 }}>{row.param}</td>
                            <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: "#6B6B6B" }}>{row.burger}</td>
                            <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: "#37352F", fontWeight: 600 }}>{row.ours}</td>
                            <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 11, color: row.delta === null ? "#BFBFBA" : Math.abs(row.delta) < 5 ? "#27AE60" : Math.abs(row.delta) < 15 ? "#F2994A" : "#EB5757" }}>
                              {row.delta !== null ? `${row.delta >= 0 ? "+" : ""}${row.delta.toFixed(1)}%` : "–"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: 11, color: "#BFBFBA", marginTop: 12, lineHeight: 1.5, margin: "12px 0 0" }}>
                    Burger's parameters are from his original OLS regression (~2019–2020). Our WLS gives more weight to recent liquid-market data, which may shift the intercept slightly. The slope (growth exponent) is base-invariant and should be nearly identical — differences reflect WLS weighting and the additional ~2,500 daily data points from CoinGecko. A fair value delta under ±15% indicates strong structural agreement.
                  </p>
                </div>
              );
            })()}
          </Toggle>
        </div>

        {/* ═══ FAQ ═══ */}
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#37352F", margin: "0 0 4px", letterSpacing: "-0.02em" }}>Frequently Asked Questions</h2>
          <p style={{ fontSize: 13, color: "#9B9A97", margin: "0 0 12px" }}>How the model works, where the data comes from, and what this can and cannot tell you about Bitcoin.</p>

          <Toggle label="What is the Bitcoin Power Law model?" open={openSections.faq_pl} onToggle={() => toggleSection("faq_pl")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>The Bitcoin Power Law model was discovered by physicist Giovanni Santostasi in 2019 and independently developed by Harold Christopher Burger in his "Power-Law Corridor of Growth" analysis. They found that when you plot Bitcoin's price against time on a logarithmic scale for both axes, the data points fall on a remarkably straight line going back to 2010. That straight line is a power law — the same type of mathematical relationship found in city population scaling, earthquake magnitude distributions, and network growth.</p>
              <p style={{ margin: "0 0 12px" }}>In practical terms, the Power Law gives Bitcoin a "fair value" at any point in time based on its age. It doesn't predict short-term price action, but it defines a structural trajectory. The model fits over 15 years of daily data with an R-squared above 0.93, meaning it accounts for more than 93% of Bitcoin's historical price variation.</p>
              <p style={{ margin: "0 0 0" }}>We measure how far the current price deviates from this line using standard deviations (σ). Deviations between +1σ and −1σ are normal. Beyond ±2σ is historically extreme. Every instance of +2σ in Bitcoin's history preceded a major correction. Every instance of −2σ preceded a major rally.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="What does it mean that Bitcoin is fractal?" open={openSections.faq_fractal} onToggle={() => toggleSection("faq_fractal")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>Look at a Bitcoin price chart for one day, then zoom out to one week, one month, one year. They look statistically similar — the same pattern of spikes, consolidations, and drops repeating at every scale. This self-similarity is the hallmark of a fractal system, first described in financial markets by mathematician Benoît Mandelbrot.</p>
              <p style={{ margin: "0 0 12px" }}>Two practical consequences follow. First, extreme price moves (crashes and parabolic rallies) happen far more often than traditional bell-curve models predict. A move that Gaussian statistics say should occur once in 10,000 years actually happens every few years in Bitcoin. Second, volatility clusters: periods of high volatility tend to be followed by more high volatility, and calm periods tend to persist. This is measurable and predictable.</p>
              <p style={{ margin: "0 0 0" }}>This dashboard uses Mandelbrot's Multifractal Model of Asset Returns (MMAR) to capture these properties. The key parameters are the Hurst exponent (H), which measures trend persistence, and the intermittency coefficient (λ²), which measures volatility clustering intensity. Together they ensure the simulations produce realistic Bitcoin-like price paths, not the artificially smooth paths of conventional models.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="How does the calculation methodology work, step by step?" open={openSections.faq_method} onToggle={() => toggleSection("faq_method")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px", fontWeight: 500, color: "#37352F" }}>The model runs a five-step pipeline, each step building on the previous one:</p>

              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>Step 1 — Power Law regression (weighted).</strong> We fit log(price) = a + b × log(days since genesis) using Weighted Least Squares across all data from 2010 to today. The weights follow an exponential decay with a ~4-year half-life: recent data from liquid, mature markets weighs more than early-era data from thin, unreliable exchanges. This prevents a $0.05 price from 2010 (traded between a handful of people) from having the same influence as a $70k price from 2024 (traded on venues with billions in daily volume). The output is the growth exponent b, the fair value curve, and the residuals. The σ bands are computed from unweighted residuals to preserve the full historical deviation range.</p>

              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>Step 2 — Fractal structure calibration.</strong> Using daily residual returns from 2020 onwards (to reflect the current market regime), we estimate two parameters. The Hurst exponent (H) is measured via Detrended Fluctuation Analysis (DFA-1), which is more robust than the classical R/S method for short and non-stationary series. DFA integrates the demeaned series, splits it into windows at multiple scales, fits a linear trend within each window, computes the RMS of the detrended fluctuations, and extracts H as the slope of log(F) vs log(scale). Both forward and backward window passes are used for better coverage. H above 0.5 indicates trend persistence, below 0.5 indicates mean-reversion. The intermittency parameter (λ²) is extracted from the multifractal partition function by fitting the scaling exponent τ(q) across moment orders q = −2 to 5 at time scales from 8 to 128 days. This captures how volatility concentrates at different frequencies. Standard financial models skip both measurements entirely and assume returns are independent and normally distributed.</p>

              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>Step 3 — Regime-switching mean-reversion.</strong> Instead of a single Ornstein-Uhlenbeck process with one fixed κ (which is the standard approach), we classify the market into two regimes using 30-day rolling absolute returns: a calm regime and a volatile regime. A separate κ is estimated for each regime via autoregression on the residuals belonging to that regime. In practice, the calm regime shows faster mean-reversion (shorter half-life: price corrects toward fair value relatively quickly) while the volatile regime shows slower reversion (longer half-life: deviations persist during turbulent periods, which is when trends and crashes extend further than a single-regime model expects). A Markov transition matrix is estimated from the historical regime sequence, and during simulation, the regime switches stochastically day by day according to these transition probabilities. Each regime also carries its own volatility scaling factor. This produces path dynamics that are qualitatively different from single-regime OU: calm periods where price gravitates steadily toward the Power Law, interrupted by explosive volatile episodes where deviations can grow before eventually reverting.</p>

              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>Step 4 — Monte Carlo path generation.</strong> Each of the 500 simulated paths is built through five simultaneous mechanisms: (a) A 10-level multiplicative cascade generates fractal trading time, creating realistic volatility clustering — this is the MMAR's core contribution, compressing and stretching time so that some simulated days are calm and others explosive. (b) Daily shocks are drawn from the actual empirical distribution of residual returns (not from a Gaussian), preserving the real fat tails, skewness, and kurtosis. (c) Consecutive shocks are correlated based on the Hurst exponent to reproduce momentum (H > 0.5) or reversals (H &lt; 0.5). (d) At each time step, the market regime (calm or volatile) switches stochastically according to the Markov transition matrix, determining the active κ and volatility scale for that day. (e) The path is anchored to the Power Law trajectory via the regime-specific OU mean-reversion. The result is paths where calm consolidation and explosive moves alternate realistically, rather than having a constant mean-reversion speed throughout.</p>

              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>Step 5 — Loss probability estimation.</strong> Rather than computing probabilities from a theoretical distribution (which would use a Gaussian approximation and systematically underestimate tail risk), we interpolate directly between the empirical percentiles (P5, P25, P50, P75, P95) of the simulated paths at each time horizon. The percentage of paths below a given price level is taken as the probability estimate.</p>

              <p style={{ margin: "0 0 12px", fontWeight: 500, color: "#37352F" }}>What makes this approach non-standard:</p>

              <p style={{ margin: "0 0 0" }}>Most Bitcoin analysis tools use either the Power Law alone (giving deterministic projections with no uncertainty quantification) or standard Monte Carlo with Gaussian noise (which underestimates crash probability by orders of magnitude). This dashboard bridges both: Power Law for structural direction, MMAR for realistic fractal noise, and regime-switching OU for trajectory anchoring with different mean-reversion dynamics in calm vs volatile markets. Additionally, the Power Law regression uses Weighted Least Squares instead of ordinary least squares, giving appropriate weight to recent liquid-market data over early thin-market prices. The Hurst exponent is estimated via DFA rather than the classical R/S method. The use of empirical shock resampling instead of parametric noise generation means every simulated shock actually occurred in Bitcoin's real history, preserving the exact distributional shape without modelling assumptions.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="What is a Monte Carlo simulation and how is it used here?" open={openSections.faq_mc} onToggle={() => toggleSection("faq_mc")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>A Monte Carlo simulation generates many random scenarios to map out the range of possible outcomes. Instead of a single forecast ("Bitcoin will be $150k next year"), it produces a distribution of 500 equally plausible futures, showing what could happen under different volatility and market conditions.</p>
              <p style={{ margin: "0 0 12px" }}>Each simulated path starts at today's price and evolves day by day for 1 year (or 3 years). The results are summarized as percentiles: P5 (the worst 5% of outcomes), P25, P50 (the median), P75, and P95 (the best 5%). This gives you a complete picture of the probability landscape, not a point estimate.</p>
              <p style={{ margin: "0 0 0" }}>When this dashboard states a loss probability (for example, "12% chance of being at a loss after 1 year"), that number comes from counting how many of the 500 simulated paths end below your purchase price. It's a direct empirical count, not a calculation from a mathematical formula. This means the fat tails and volatility clustering from the MMAR model flow through to the probability estimates.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="How does the composite buy/sell signal work?" open={openSections.faq_signal} onToggle={() => toggleSection("faq_signal")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>The YES / CAUTIOUSLY / NOT NOW verdict is produced by a composite scoring system that weighs seven independent signals: Power Law valuation (25% weight), Monte Carlo risk-reward asymmetry (20%), 1-year loss probability (15%), 30-day price outlook (15%), current market regime (12%), market temperature (8%), and Hurst trend persistence (5%). Each signal contributes a score between −1 (strongly bearish) and +1 (strongly bullish).</p>
              <p style={{ margin: "0 0 12px" }}>The weighted sum produces a composite score from −1 to +1. Scores above +0.5 produce "YES" with high confidence, +0.2 to +0.5 produce "YES" with moderate confidence, −0.1 to +0.2 produce "CAUTIOUSLY", and below −0.1 produce "NOT NOW". The "What's driving this" section shows each signal's contribution visually so you can see which factors agree and which conflict.</p>
              <p style={{ margin: "0 0 0" }}>The signal assumes a minimum 1-year holding period. It is not designed for short-term trading. The longer your intended holding period, the more reliable the signal becomes, because the Power Law's structural gravity has more time to assert itself.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="Where does the data come from and how fresh is it?" open={openSections.faq_data} onToggle={() => toggleSection("faq_data")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>The dataset is assembled from three sources. Monthly prices from July 2010 to March 2013 are hardcoded (this era predates reliable exchange APIs). Daily closing prices from April 2013 through December 2019 are fetched from the CoinGecko API on each page load, providing ~2,500 daily data points for this period. Recent daily prices (2020 onwards) come from the Binance API (primary) or Kraken (fallback), with the spot price refreshing every 60 seconds. The total dataset typically exceeds 4,500 data points — roughly 2.5x more than the previous monthly-only historical approach.</p>
              <p style={{ margin: "0 0 0" }}>Every calculation — the Weighted Least Squares Power Law regression, Hurst exponent via Detrended Fluctuation Analysis, multifractal partition function, Ornstein-Uhlenbeck calibration, and all 1,000 Monte Carlo path simulations (500 paths for 1 year, 500 for 3 years) — runs entirely in your browser using JavaScript. Nothing is pre-computed, stored on a server, or cached between sessions. The model recalibrates from scratch on every page load using the latest available data.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="How accurate is this model? Has it been backtested?" open={openSections.faq_accuracy} onToggle={() => toggleSection("faq_accuracy")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>The Power Law regression has an R² above 0.93 over 15+ years of data, which is exceptionally high for any financial model. The σ-band framework has correctly identified every major cycle top (at or above +2σ) and every major cycle bottom (at or near −2σ) in Bitcoin's history. However, past statistical consistency does not guarantee future performance.</p>
              <p style={{ margin: "0 0 12px" }}>The MMAR fractal parameters (H and λ²) are calibrated on 2020+ data, which means they reflect the current market microstructure but may not capture structural shifts from earlier eras. The Monte Carlo simulations use 500 paths per horizon, providing stable estimates across all percentiles including the tails (P5, P95).</p>
              <p style={{ margin: "0 0 0" }}>The composite signal has not been formally backtested across full historical cycles because it depends on the Monte Carlo output, which is stochastic by nature (different each run). The individual components — Power Law deviation, Hurst exponent, multifractal spectrum — have been validated against Bitcoin's empirical properties in academic research.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="How is this different from technical analysis?" open={openSections.faq_ta} onToggle={() => toggleSection("faq_ta")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>Technical analysis (TA) looks at price patterns, support/resistance lines, moving averages, and chart formations to predict short-term movements. It works — not because the patterns have inherent predictive power, but because enough market participants believe in them and act on them, creating self-fulfilling prophecies. When millions of traders draw the same trendline and set buy orders at the same level, the level holds. That's real, and it moves money.</p>
              <p style={{ margin: "0 0 12px" }}>This dashboard does something fundamentally different. It doesn't look at chart patterns or trading signals. It fits a mathematical growth model (Power Law) to Bitcoin's entire 15-year history, calibrates the statistical properties of how price deviates from that model (using fractal mathematics from Mandelbrot), and then simulates 500 possible futures that respect both the long-term trajectory and the realistic short-term chaos. The output isn't "a triangle is forming on the 4-hour chart" — it's "there's a 12% probability of being at a loss after 1 year based on where the price currently sits relative to its structural growth curve."</p>
              <p style={{ margin: "0 0 12px" }}>TA is useful for timing entries within days or weeks. This model is useful for deciding whether to enter at all, and sizing your position, over months or years. They operate on completely different time horizons and answer different questions. A TA trader might correctly call a 5% pullback next week that this model doesn't see. But this model can tell you whether paying today's price gives you favorable odds over the next 1–3 years, which TA fundamentally cannot.</p>
              <p style={{ margin: "0 0 0" }}>The ideal approach combines both: use this model to decide if the structural position is favorable, then use TA to fine-tune your entry timing within that larger framework.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="How should this NOT be interpreted?" open={openSections.faq_notwhat} onToggle={() => toggleSection("faq_notwhat")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>This is not a price prediction.</strong> The model doesn't say "Bitcoin will be $150k in a year." It says "the structural model's fair value in a year is $X, and simulations show a range of $Y to $Z with a median of $W." The difference matters. A prediction is a single number you can be right or wrong about. A distribution is a map of probabilities.</p>
              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>This is not a trading signal.</strong> The YES/NO verdict assumes a minimum 1-year holding period. If you're buying today to sell next week, this tool has nothing useful to tell you. The Power Law and Monte Carlo operate on structural time scales, not market microstructure.</p>
              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>This is not a guarantee of anything.</strong> An R² of 0.93 is impressive, but it means 7% of the variance is unexplained. The 500 simulated paths are plausible futures, not the set of all possible futures. A black swan event — a major exchange collapse, a protocol vulnerability, a coordinated regulatory ban — lives outside the model's universe. The model can only see what has historically happened, not what has never happened before.</p>
              <p style={{ margin: "0 0 12px" }}><strong style={{ color: "#37352F" }}>The loss probabilities are estimates, not actuarial certitudes.</strong> "12% probability of loss after 1 year" means 60 out of 500 simulated paths ended below your price. It does not mean there's exactly a 12% chance in reality. The simulations are only as good as the model that generates them.</p>
              <p style={{ margin: "0 0 0" }}><strong style={{ color: "#37352F" }}>Do not invest money you cannot afford to lose.</strong> Even in the model's most favorable readings — deep value, all signals green, 3% probability of loss — there exists a non-zero chance of catastrophic loss. Bitcoin remains a volatile, non-sovereign, uninsured asset. This dashboard gives you the best quantitative framework we can build, but the final decision and its consequences are yours alone.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="Who built this and why?" open={openSections.faq_who} onToggle={() => toggleSection("faq_who")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>This dashboard was built by <a href="https://www.linkedin.com/in/eduforte/" target="_blank" rel="noopener noreferrer" style={{ color: "#37352F", fontWeight: 600 }}>Edu Forte</a> and <a href="https://www.commonsense.finance/" target="_blank" rel="noopener noreferrer" style={{ color: "#37352F", fontWeight: 600 }}>CommonSense</a>, a digital asset manager based in Barcelona. The original motivation was to create a rigorous, quantitative framework for Bitcoin valuation that goes beyond simple Power Law charts — incorporating the fractal properties of Bitcoin's volatility (via Mandelbrot's MMAR) and providing honest probabilistic outcomes (via anchored Monte Carlo simulations).</p>
              <p style={{ margin: "0 0 0" }}>The underlying research draws on Giovanni Santostasi's Power Law work, Harold Christopher Burger's corridor-of-growth analysis, Benoît Mandelbrot's fractal market theory (particularly the MMAR as described in "The Misbehavior of Markets"), and the Ornstein-Uhlenbeck process from quantitative finance. The specific combination — WLS Power Law, MMAR fractal noise, regime-switching OU, DFA-based Hurst estimation, and empirical shock resampling — is an original approach developed for this tool. You can compare our calibration against Burger's original OLS parameters in the Model Parameters section.</p>
            </div>
          </Toggle>
          <Divider />

          <Toggle label="What are the limitations of this analysis?" open={openSections.faq_limits} onToggle={() => toggleSection("faq_limits")}>
            <div style={{ fontSize: 14, color: "#4F4F4F", lineHeight: 1.8 }}>
              <p style={{ margin: "0 0 12px" }}>The Bitcoin Power Law is an empirical observation, not a physical law. It has held for 15 years but could break if Bitcoin's fundamental adoption dynamics change — through regulatory prohibition, protocol failure, or displacement by a competing technology. The model has no mechanism to anticipate these structural breaks.</p>
              <p style={{ margin: "0 0 12px" }}>The Monte Carlo simulations use 500 paths per horizon, which provides stable percentile estimates including tails, though a larger sample would further improve precision. The fractal calibration window (2020 onwards) reflects current market dynamics and may miss regime changes. The 30-day outlook and regime detection use heuristic scoring rather than formal statistical tests.</p>
              <p style={{ margin: "0 0 0" }}>This is a quantitative model, not financial advice. It provides mathematically grounded analysis of Bitcoin's position relative to its historical growth trajectory and simulated future paths. It cannot predict black swan events, geopolitical shocks, or fundamental shifts in adoption. It should be one input among many in any investment decision. Never invest more than you can afford to lose.</p>
            </div>
          </Toggle>
        </div>

        {/* ═══ FOOTER ═══ */}
        <div style={{ marginTop: 40, padding: "28px 0 16px", borderTop: "1px solid #E8E5E0" }}>

          {/* Disclaimer */}
          <div style={{ background: "#FFFBF0", border: "1px solid #F2E8C9", borderRadius: 8, padding: "14px 18px", marginBottom: 24 }}>
            <p style={{ fontSize: 12, color: "#9B8A5E", lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
              This is a quantitative model, not financial advice. Past statistical patterns do not guarantee future outcomes. Never invest more than you can afford to lose.
            </p>
          </div>

          {/* Method + Credits */}
          <div className="grid-footer" style={{ display: "grid", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, color: "#BFBFBA", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 8 }}>Methodology</div>
              <p style={{ fontSize: 12, color: "#9B9A97", lineHeight: 1.7, margin: 0 }}>
                Santostasi Power Law (WLS) + Mandelbrot MMAR (fractal cascades, DFA) + Regime-Switching Ornstein-Uhlenbeck + 500-path Monte Carlo with empirical resampling.
              </p>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#BFBFBA", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 8 }}>Built by</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <a href="https://www.commonsense.finance/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#37352F", fontWeight: 600, textDecoration: "none" }}>
                  CommonSense <span style={{ color: "#BFBFBA", fontWeight: 400 }}>· Digital Asset Manager</span>
                </a>
                <a href="https://www.linkedin.com/in/eduforte/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#37352F", fontWeight: 600, textDecoration: "none" }}>
                  Edu Forte <span style={{ color: "#BFBFBA", fontWeight: 400 }}>· LinkedIn</span>
                </a>
              </div>
            </div>
          </div>

          {/* References */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 10, color: "#BFBFBA", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 8 }}>References</div>
            <p style={{ fontSize: 11, color: "#BFBFBA", lineHeight: 1.7, margin: 0 }}>
              G. Santostasi, "Bitcoin Spread as a Power Law" (2019) · H.C. Burger, "Bitcoin's Natural Long-Term Power-Law Corridor of Growth" (2019) · B. Mandelbrot & R. Hudson, "The (Mis)behavior of Markets" (2004) · B. Mandelbrot, A. Fisher & L. Calvet, "A Multifractal Model of Asset Returns" (1997) · C.-K. Peng et al., "Mosaic Organization of DNA Nucleotides" — DFA method (1994)
            </p>
          </div>

          {/* Bottom line */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #F1F1EF", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#E8E5E0" }}>
              Spot refreshes every 60s · All calculations run in your browser · No data stored
            </span>
            <span style={{ fontSize: 10, color: "#E8E5E0" }}>
              © {new Date().getFullYear()} CommonSense Technologies 89 S.L.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
