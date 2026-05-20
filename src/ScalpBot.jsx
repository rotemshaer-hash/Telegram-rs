import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

const G = {
  bg: "#0B1120", panel: "rgba(255,255,255,0.07)", border: "rgba(255,255,255,0.14)",
  borderHi: "rgba(255,255,255,0.25)", text: "#FFFFFF", mid: "#C8D8F0", muted: "#6B82A8",
  green: "#00FFB0", greenL: "rgba(0,255,176,0.13)", greenB: "rgba(0,255,176,0.35)",
  red:   "#FF3D6B", redL:   "rgba(255,61,107,0.13)", redB:  "rgba(255,61,107,0.35)",
  blue:  "#5BB8FF", blueL:  "rgba(91,184,255,0.13)", blueB: "rgba(91,184,255,0.35)",
  amber: "#FFD000", amberL: "rgba(255,208,0,0.13)",  amberB:"rgba(255,208,0,0.35)",
  orange: "#FFA030",
};

const card = {
  background: G.panel, border: `1px solid ${G.border}`, borderRadius: 18,
  padding: "14px 16px", marginBottom: 10,
  backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
};
const lbl = { fontSize: 10, fontWeight: 900, letterSpacing: 2.5, color: G.muted, textTransform: "uppercase", marginBottom: 10, display: "block" };

function calcEMA(arr, p) {
  if (arr.length < p) return arr.map(() => null);
  const k = 2 / (p + 1);
  let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const out = [...Array(p - 1).fill(null), e];
  for (let i = p; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out.push(e); }
  return out;
}

function calcRSI(arr, p = 14) {
  if (arr.length < p + 1) return arr.map(() => null);
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = arr[i] - arr[i-1]; d > 0 ? (g += d) : (l -= d); }
  g /= p; l /= p;
  const out = [...Array(p).fill(null), l === 0 ? 100 : 100 - 100 / (1 + g / l)];
  for (let i = p + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i-1];
    g = (g * (p-1) + Math.max(d, 0)) / p;
    l = (l * (p-1) + Math.max(-d, 0)) / p;
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}

function BuyDot(props) {
  const { cx, cy } = props;
  if (cx == null || cy == null || isNaN(cx) || isNaN(cy)) return null;
  return (
    <g>
      <polygon points={`${cx},${cy-18} ${cx-10},${cy+2} ${cx+10},${cy+2}`}
        fill={G.green} stroke={G.bg} strokeWidth={1.5}
        style={{ filter: `drop-shadow(0 0 5px ${G.green})` }}/>
    </g>
  );
}

function SellDot(props) {
  const { cx, cy } = props;
  if (cx == null || cy == null || isNaN(cx) || isNaN(cy)) return null;
  return (
    <g>
      <polygon points={`${cx},${cy+18} ${cx-10},${cy-2} ${cx+10},${cy-2}`}
        fill={G.red} stroke={G.bg} strokeWidth={1.5}
        style={{ filter: `drop-shadow(0 0 5px ${G.red})` }}/>
    </g>
  );
}

function PriceTip({ active, payload }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "rgba(6,10,20,0.97)", border: `1px solid ${G.border}`, borderRadius: 10, padding: "8px 12px", fontSize: 11 }}>
      <div style={{ color: G.muted, marginBottom: 4 }}>{d.timeStr}</div>
      <div style={{ fontFamily: "monospace", fontWeight: 900, color: G.text, fontSize: 13 }}>${d.close?.toFixed(5)}</div>
      {d.ema9  && <div style={{ color: G.blue,   marginTop: 2 }}>EMA9 ${d.ema9.toFixed(5)}</div>}
      {d.ema21 && <div style={{ color: G.orange, marginTop: 2 }}>EMA21 ${d.ema21.toFixed(5)}</div>}
    </div>
  );
}

function RSITip({ active, payload }) {
  if (!active || !payload?.[0]) return null;
  return (
    <div style={{ background: "rgba(6,10,20,0.97)", border: `1px solid ${G.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 11 }}>
      <span style={{ fontFamily: "monospace", color: G.amber }}>RSI {payload[0].payload?.rsi?.toFixed(1)}</span>
    </div>
  );
}

export default function ScalpBot() {
  const [candles, setCandles]        = useState([]);
  const [status,  setStatus]         = useState("connecting");
  const [position, setPositionState] = useState(null);
  const [trades,  setTrades]         = useState([]);
  const [signal,  setSignal]         = useState(null);
  const [flashOn, setFlashOn]        = useState(false);
  const posRef        = useRef(null);
  const wsRef         = useRef(null);
  const processedRef  = useRef(new Set());
  const flashTimer    = useRef(null);
  const signalTimer   = useRef(null);
  const prevPosRef    = useRef(null);

  const setPosition = useCallback((p) => { posRef.current = p; setPositionState(p); }, []);

  useEffect(() => {
    let alive = true;
    async function init() {
      try {
        setStatus("loading");
        const r = await fetch("https://api.binance.com/api/v3/klines?symbol=XRPUSDT&interval=5m&limit=120");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const raw = await r.json();
        if (!alive) return;
        setCandles(raw.map(k => ({
          time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
          timeStr: new Date(k[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        })));
        setStatus("live");
      } catch { if (alive) setStatus("error"); return; }

      const ws = new WebSocket("wss://stream.binance.com:9443/ws/xrpusdt@kline_5m");
      ws.onmessage = ({ data }) => {
        if (!alive) return;
        const { k } = JSON.parse(data);
        const c = {
          time: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v,
          timeStr: new Date(k.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setCandles(prev => {
          const last = prev[prev.length - 1];
          return last?.time === c.time ? [...prev.slice(0, -1), c] : [...prev.slice(-119), c];
        });
      };
      ws.onopen  = () => { if (alive) setStatus("live"); };
      ws.onclose = () => { if (alive) setStatus("reconnecting"); };
      ws.onerror = () => { if (alive) setStatus("error"); };
      wsRef.current = ws;
    }
    init();
    return () => { alive = false; wsRef.current?.close(); };
  }, []);

  const chartData = useMemo(() => {
    if (candles.length < 22) return [];
    const closes = candles.map(c => c.close);
    const e9  = calcEMA(closes, 9);
    const e21 = calcEMA(closes, 21);
    const rsi = calcRSI(closes, 14);
    return candles.map((c, i) => ({
      ...c,
      ema9:  e9[i],
      ema21: e21[i],
      rsi:   rsi[i],
      buySignal:  i > 0 && e9[i] && e21[i] && e9[i-1] && e21[i-1] && e9[i-1] < e21[i-1] && e9[i] >= e21[i] ? c.close : null,
      sellSignal: i > 0 && e9[i] && e21[i] && e9[i-1] && e21[i-1] && e9[i-1] > e21[i-1] && e9[i] <= e21[i] ? c.close : null,
    }));
  }, [candles]);

  useEffect(() => {
    if (chartData.length < 2) return;
    const cur = chartData[chartData.length - 1];
    const pos = posRef.current;

    if (pos) {
      const p = cur.close;
      const hitTP = pos.dir === "LONG" ? p >= pos.tp : p <= pos.tp;
      const hitSL = pos.dir === "LONG" ? p <= pos.sl : p >= pos.sl;
      if (hitTP || hitSL) {
        const pnl = ((pos.dir === "LONG" ? p - pos.entry : pos.entry - p) / pos.entry * 100);
        setTrades(prev => [{ id: Date.now(), dir: pos.dir, entry: pos.entry, exit: p,
          pnl: pnl.toFixed(3), win: pnl > 0, reason: hitTP ? "TP Hit" : "SL Hit",
          openTime: pos.time, closeTime: cur.timeStr }, ...prev].slice(0, 30));
        setPosition(null);
        return;
      }
    }

    if (!processedRef.current.has(cur.time)) {
      processedRef.current.add(cur.time);
      if (cur.buySignal && !pos) {
        setPosition({ dir: "LONG",  entry: cur.close, sl: cur.close * 0.9975, tp: cur.close * 1.006,  time: cur.timeStr });
      } else if (cur.sellSignal && !pos) {
        setPosition({ dir: "SHORT", entry: cur.close, sl: cur.close * 1.0025, tp: cur.close * 0.994,  time: cur.timeStr });
      } else if (pos) {
        const rev = (pos.dir === "LONG" && cur.sellSignal) || (pos.dir === "SHORT" && cur.buySignal);
        if (rev) {
          const p = cur.close;
          const pnl = ((pos.dir === "LONG" ? p - pos.entry : pos.entry - p) / pos.entry * 100);
          setTrades(prev => [{ id: Date.now(), dir: pos.dir, entry: pos.entry, exit: p,
            pnl: pnl.toFixed(3), win: pnl > 0, reason: "Reversal",
            openTime: pos.time, closeTime: cur.timeStr }, ...prev].slice(0, 30));
          setPosition(null);
        }
      }
    }
  }, [chartData, setPosition]);

  // ── 10-min comprehensive signal ────────────────────────────────────────────
  const analyzeSignal = useCallback(() => {
    const data = chartData;
    if (data.length < 22) return;
    const cur = data[data.length - 1];
    const prev = data[data.length - 2];
    const last5 = data.slice(-5);
    let score = 0;
    const reasons = [];

    // EMA direction
    if (cur.ema9 > cur.ema21) { score += 2; reasons.push("EMA9 מעל EMA21 ↑"); }
    else                       { score -= 2; reasons.push("EMA9 מתחת EMA21 ↓"); }

    // EMA momentum (narrowing or widening)
    const gapNow  = cur.ema9 - cur.ema21;
    const gapPrev = prev.ema9 - prev.ema21;
    if (gapNow > 0 && gapNow > gapPrev) { score += 1; reasons.push("פער EMA מתרחב ▲"); }
    if (gapNow < 0 && gapNow < gapPrev) { score -= 1; reasons.push("פער EMA מתרחב ▼"); }

    // Price vs EMAs
    if (cur.close > cur.ema21) score += 1; else score -= 1;
    if (cur.close > cur.ema9)  score += 1; else score -= 1;

    // RSI
    const rsi = cur.rsi;
    if (rsi < 30)      { score += 3; reasons.push(`RSI ${rsi.toFixed(0)} — Oversold 🟢`); }
    else if (rsi < 45) { score += 1; reasons.push(`RSI ${rsi.toFixed(0)} — נמוך`); }
    else if (rsi > 70) { score -= 3; reasons.push(`RSI ${rsi.toFixed(0)} — Overbought 🔴`); }
    else if (rsi > 55) { score -= 1; reasons.push(`RSI ${rsi.toFixed(0)} — גבוה`); }
    else                             reasons.push(`RSI ${rsi.toFixed(0)} — ניטרלי`);

    // Price momentum (last 5 candles)
    const momentum = (cur.close - last5[0].close) / last5[0].close * 100;
    if (momentum > 0.15)       { score += 2; reasons.push(`מומנטום +${momentum.toFixed(2)}% ↑`); }
    else if (momentum > 0.05)  { score += 1; reasons.push(`מומנטום +${momentum.toFixed(2)}%`); }
    else if (momentum < -0.15) { score -= 2; reasons.push(`מומנטום ${momentum.toFixed(2)}% ↓`); }
    else if (momentum < -0.05) { score -= 1; reasons.push(`מומנטום ${momentum.toFixed(2)}%`); }

    // Candle direction (last 3)
    const upCount = last5.slice(-3).filter(c => c.close >= c.open).length;
    if (upCount >= 3)      { score += 1; reasons.push("3/3 נרות עולים"); }
    else if (upCount === 0){ score -= 1; reasons.push("3/3 נרות יורדים"); }

    let dir = score >= 4 ? "LONG" : score <= -4 ? "SHORT" : "WAIT";
    setSignal({ dir, score, reasons, time: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) });
  }, [chartData]);

  // run on load + every 10 min
  useEffect(() => {
    if (chartData.length < 22) return;
    analyzeSignal();
    signalTimer.current = setInterval(analyzeSignal, 10 * 60 * 1000);
    return () => clearInterval(signalTimer.current);
  }, [chartData.length >= 22 ? 1 : 0]); // eslint-disable-line

  // flash when new position opens
  useEffect(() => {
    if (position && !prevPosRef.current) {
      setFlashOn(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashOn(false), 8000);
    }
    prevPosRef.current = position;
  }, [position]);

  const latest  = chartData[chartData.length - 1];
  const first   = chartData[0];
  const change  = latest && first ? ((latest.close - first.close) / first.close * 100) : 0;
  const livePnl = position && latest
    ? ((position.dir === "LONG" ? latest.close - position.entry : position.entry - latest.close) / position.entry * 100)
    : null;
  const wins   = trades.filter(t => t.win).length;
  const netPnl = trades.reduce((a, t) => a + +t.pnl, 0).toFixed(2);

  return (
    <div style={{
      fontFamily: "'DM Sans',system-ui,sans-serif", background: G.bg, color: G.text,
      minHeight: "100vh", padding: 14,
      backgroundImage: "radial-gradient(ellipse 80% 40% at 50% 0%, rgba(77,171,255,0.06), transparent)",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1)}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.4)}}
        @keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes flash{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.02)}}
        .fade{animation:up 0.25s ease}
        .flash{animation:flash 0.6s ease infinite}
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: G.muted, fontWeight: 800, letterSpacing: 2.5, marginBottom: 6 }}>XRP / USDT · 5M · BINANCE</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: "monospace", fontSize: 36, fontWeight: 900, color: change >= 0 ? G.green : G.red, textShadow: `0 0 24px ${change >= 0 ? G.green : G.red}80` }}>
              {latest ? `$${latest.close.toFixed(5)}` : <span style={{ color: G.muted }}>—</span>}
            </span>
            {latest && (
              <span style={{ fontSize: 14, fontWeight: 900, padding: "4px 10px", borderRadius: 8, color: change >= 0 ? G.green : G.red, background: change >= 0 ? G.greenL : G.redL, border: `1px solid ${change >= 0 ? G.greenB : G.redB}` }}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: status === "live" ? G.green : status === "error" ? G.red : G.amber,
              animation: status === "live" ? "pulse 2s infinite" : "none",
              boxShadow: status === "live" ? `0 0 8px ${G.green}` : "none",
            }}/>
            <span style={{ fontSize: 11, color: G.muted, fontWeight: 700, fontFamily: "monospace" }}>
              {status.toUpperCase()}
            </span>
          </div>
          {trades.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: G.amber, fontWeight: 700 }}>
              {wins}W/{trades.length - wins}L · Net {+netPnl >= 0 ? "+" : ""}{netPnl}%
            </div>
          )}
        </div>
      </div>

      {/* ── Flash banner ── */}
      {flashOn && position && (
        <div className="flash" style={{
          marginBottom: 10, borderRadius: 18, padding: "16px 20px",
          background: position.dir === "LONG"
            ? `linear-gradient(135deg, rgba(0,255,176,0.25), rgba(0,255,176,0.1))`
            : `linear-gradient(135deg, rgba(255,61,107,0.25), rgba(255,61,107,0.1))`,
          border: `2px solid ${position.dir === "LONG" ? G.green : G.red}`,
          boxShadow: `0 0 30px ${position.dir === "LONG" ? G.green : G.red}60`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 2, color: position.dir === "LONG" ? G.green : G.red, marginBottom: 4 }}>
              ⚡ כנס עכשיו!
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 900, color: position.dir === "LONG" ? G.green : G.red }}>
              {position.dir === "LONG" ? "▲ LONG" : "▼ SHORT"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: G.mid }}>כניסה</div>
            <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 900, color: G.text }}>${position.entry.toFixed(5)}</div>
            <div style={{ fontSize: 10, color: position.dir === "LONG" ? G.green : G.red, marginTop: 4 }}>
              SL ${position.sl.toFixed(4)} · TP ${position.tp.toFixed(4)}
            </div>
          </div>
        </div>
      )}

      {/* ── 10-min signal ── */}
      {signal && (
        <div style={{
          ...card,
          background: signal.dir === "LONG"
            ? `linear-gradient(135deg, rgba(0,255,176,0.1), rgba(0,0,0,0.05))`
            : signal.dir === "SHORT"
            ? `linear-gradient(135deg, rgba(255,61,107,0.1), rgba(0,0,0,0.05))`
            : `linear-gradient(135deg, rgba(255,208,0,0.07), rgba(0,0,0,0.05))`,
          border: `1px solid ${signal.dir === "LONG" ? G.greenB : signal.dir === "SHORT" ? G.redB : G.amberB}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={lbl}>ניתוח כל 10 דקות</span>
            <span style={{ fontSize: 10, color: G.muted }}>עודכן {signal.time}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{
              fontFamily: "monospace", fontSize: 26, fontWeight: 900,
              color: signal.dir === "LONG" ? G.green : signal.dir === "SHORT" ? G.red : G.amber,
              textShadow: `0 0 20px ${signal.dir === "LONG" ? G.green : signal.dir === "SHORT" ? G.red : G.amber}80`,
            }}>
              {signal.dir === "LONG" ? "▲ LONG" : signal.dir === "SHORT" ? "▼ SHORT" : "⏸ WAIT"}
            </div>
            <div style={{
              fontSize: 12, fontWeight: 900, padding: "4px 12px", borderRadius: 10,
              color: G.bg, background: signal.dir === "LONG" ? G.green : signal.dir === "SHORT" ? G.red : G.amber,
            }}>
              ציון {signal.score > 0 ? "+" : ""}{signal.score}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {signal.reasons.map((r, i) => (
              <span key={i} style={{
                fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 8,
                background: "rgba(255,255,255,0.07)", color: G.mid, border: `1px solid ${G.border}`,
              }}>{r}</span>
            ))}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ display: "flex", gap: 14, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={lbl}>PRICE CHART</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: G.blue }}>── EMA 9</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: G.orange }}>── EMA 21</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: G.green }}>▲ BUY</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: G.red }}>▼ SELL</span>
        </div>
        {chartData.length < 22 ? (
          <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: G.muted, fontSize: 13 }}>
            {status === "error" ? "⚠️ Cannot connect to Binance" : "Loading market data…"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData.slice(-60)} margin={{ top: 20, right: 62, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={G.blue} stopOpacity={0.15}/>
                  <stop offset="95%" stopColor={G.blue} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="timeStr" tick={{ fontSize: 9, fill: G.muted }} axisLine={false} tickLine={false} interval={9}/>
              <YAxis domain={["auto","auto"]} tick={{ fontSize: 9, fill: G.muted }} axisLine={false} tickLine={false}
                width={62} orientation="right" tickFormatter={v => `$${v.toFixed(3)}`}/>
              <Tooltip content={<PriceTip/>}/>
              {position && <>
                <ReferenceLine y={position.sl}    stroke={G.red}   strokeDasharray="5 3" strokeWidth={1} label={{ value: "SL",    position: "insideRight", fill: G.red,   fontSize: 9, fontWeight: 800 }}/>
                <ReferenceLine y={position.tp}    stroke={G.green} strokeDasharray="5 3" strokeWidth={1} label={{ value: "TP",    position: "insideRight", fill: G.green, fontSize: 9, fontWeight: 800 }}/>
                <ReferenceLine y={position.entry} stroke={G.blue}  strokeDasharray="7 2" strokeWidth={1.5} label={{ value: "ENTRY", position: "insideRight", fill: G.blue,  fontSize: 9, fontWeight: 800 }}/>
              </>}
              <Area  type="monotone" dataKey="close"      stroke={G.blue}   strokeWidth={2}   fill="url(#pg)" dot={false} activeDot={{ r: 4, fill: G.blue, stroke: G.bg }}/>
              <Line  type="monotone" dataKey="ema9"       stroke={G.blue}   strokeWidth={1.5} dot={false} activeDot={false} strokeOpacity={0.75} connectNulls={false}/>
              <Line  type="monotone" dataKey="ema21"      stroke={G.orange} strokeWidth={1.5} dot={false} activeDot={false} strokeOpacity={0.75} connectNulls={false}/>
              <Line  type="monotone" dataKey="buySignal"  stroke="transparent" dot={<BuyDot/>}  activeDot={false} isAnimationActive={false} connectNulls={false}/>
              <Line  type="monotone" dataKey="sellSignal" stroke="transparent" dot={<SellDot/>} activeDot={false} isAnimationActive={false} connectNulls={false}/>
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {chartData.length >= 22 && (
        <div style={{ ...card, padding: "12px 16px 8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ ...lbl, marginBottom: 0 }}>RSI 14</span>
            {latest?.rsi && (
              <span style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 900, color: latest.rsi > 70 ? G.red : latest.rsi < 30 ? G.green : G.amber }}>
                {latest.rsi.toFixed(1)}{latest.rsi > 70 ? " OB" : latest.rsi < 30 ? " OS" : ""}
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={chartData.slice(-60)} margin={{ top: 4, right: 62, bottom: 0, left: 0 }}>
              <XAxis dataKey="timeStr" hide/>
              <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: G.muted }} axisLine={false} tickLine={false} width={62} ticks={[30, 50, 70]} orientation="right"/>
              <Tooltip content={<RSITip/>}/>
              <ReferenceLine y={70} stroke={G.red}   strokeDasharray="4 3" strokeOpacity={0.4}/>
              <ReferenceLine y={50} stroke={G.muted} strokeDasharray="3 5" strokeOpacity={0.2}/>
              <ReferenceLine y={30} stroke={G.green} strokeDasharray="4 3" strokeOpacity={0.4}/>
              <Area type="monotone" dataKey="rsi" stroke={G.amber} strokeWidth={1.5} fill={G.amberL} dot={false} connectNulls={false}/>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {position ? (
        <div className="fade" style={{
          ...card,
          background: position.dir === "LONG" ? `linear-gradient(135deg,${G.greenL},rgba(0,0,0,0.05))` : `linear-gradient(135deg,${G.redL},rgba(0,0,0,0.05))`,
          border: `1px solid ${position.dir === "LONG" ? G.greenB : G.redB}`,
        }}>
          <span style={lbl}>ACTIVE POSITION</span>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: "monospace", fontSize: 32, fontWeight: 900, color: position.dir === "LONG" ? G.green : G.red, textShadow: `0 0 20px ${position.dir === "LONG" ? G.green : G.red}60` }}>
                {position.dir === "LONG" ? "▲ LONG" : "▼ SHORT"}
              </div>
              <div style={{ fontSize: 11, color: G.mid, marginTop: 8 }}>
                Entry: <span style={{ fontFamily: "monospace", fontWeight: 800, color: G.blue }}>${position.entry.toFixed(5)}</span>
              </div>
              <div style={{ fontSize: 10, color: G.muted, marginTop: 3 }}>Opened {position.time}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: G.muted, marginBottom: 4 }}>LIVE P&L</div>
              <div style={{ fontFamily: "monospace", fontSize: 32, fontWeight: 900, color: livePnl >= 0 ? G.green : G.red, textShadow: `0 0 20px ${livePnl >= 0 ? G.green : G.red}80` }}>
                {livePnl >= 0 ? "+" : ""}{livePnl?.toFixed(3)}%
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
            {[["STOP LOSS", position.sl, G.red], ["TAKE PROFIT", position.tp, G.green]].map(([l, v, c]) => (
              <div key={l} style={{ background: `${c}15`, border: `1px solid ${c}30`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: c, letterSpacing: 1.5, marginBottom: 5 }}>{l}</div>
                <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 900, color: c }}>${v.toFixed(5)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ ...card, textAlign: "center", padding: 22 }}>
          <div style={{ fontSize: 13, color: G.muted }}>
            {chartData.length < 22 ? "Calculating indicators…" : "⏳ Waiting for EMA crossover signal"}
          </div>
          {chartData.length >= 22 && latest && (
            <div style={{ fontSize: 11, color: G.muted, marginTop: 6 }}>
              EMA9 {latest.ema9 > latest.ema21 ? ">" : "<"} EMA21 · RSI {latest.rsi?.toFixed(0)}
            </div>
          )}
        </div>
      )}

      {trades.length > 0 && (
        <div style={card}>
          <span style={lbl}>TRADE HISTORY</span>
          {trades.slice(0, 10).map(t => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${G.border}` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 900, color: t.dir === "LONG" ? G.green : G.red }}>
                  {t.dir === "LONG" ? "▲" : "▼"}
                </span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.win ? G.green : G.red }}>{t.reason}</div>
                  <div style={{ fontSize: 9, color: G.muted }}>{t.openTime} → {t.closeTime}</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 900, color: t.win ? G.green : G.red }}>
                  {+t.pnl >= 0 ? "+" : ""}{t.pnl}%
                </div>
                <div style={{ fontSize: 9, color: G.muted }}>${t.exit.toFixed(5)}</div>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: G.muted }}>
            <span>{wins} wins / {trades.length - wins} losses</span>
            <span style={{ color: +netPnl >= 0 ? G.green : G.red, fontWeight: 700 }}>Net {+netPnl >= 0 ? "+" : ""}{netPnl}%</span>
          </div>
        </div>
      )}

      <div style={{ fontSize: 9, color: G.muted, textAlign: "center", marginTop: 14, lineHeight: 2 }}>
        XRP/USDT · Binance · Real-time WebSocket · Free · v3<br/>
        <span style={{ color: "rgba(255,255,255,0.06)" }}>Not financial advice · EMA 9/21 crossover signals</span>
      </div>
    </div>
  );
}
