import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchSignal(apiKey) {
  const now = new Date();
  const prompt = `You are an elite aggressive XRP 5-minute scalp trader. You are BOLD and DECISIVE. You never hesitate. You find the best possible entry and commit to it.

Current UTC: ${now.getUTCHours()}:${String(now.getUTCMinutes()).padStart(2,"0")}

Search the web RIGHT NOW for:
1. XRP exact current price
2. Short-term price momentum (last 30-60 min)
3. Bitcoin direction right now
4. XRP order book pressure (buyers vs sellers)
5. Any news in last 2 hours affecting XRP

YOUR JOB: Find the single best 5-minute scalp entry RIGHT NOW. Be aggressive. If there is ANY tradeable setup — take it. Only return WAIT if the market is completely dead (no volume, no momentum, major crash happening).

Think like this:
- Is price near a key level? → Entry opportunity
- Is momentum building? → Get in early
- Is there a pullback to EMA? → Perfect entry
- Is RSI oversold/overbought? → Countertrend scalp

Give ONE precise entry price. Not a zone. One number. The BEST price to enter RIGHT NOW.

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "price": <exact current XRP price - 5 decimal places>,
  "change1h": <1h % change>,
  "change24h": <24h % change>,

  "direction": "LONG" or "SHORT",
  "entry": <single precise entry price - the best price to enter>,
  "stop_loss": <tight stop - max 0.25% away>,
  "tp1": <first exit - 0.4-0.6% away>,
  "tp2": <second exit - 0.8-1.2% away>,
  "stop_pct": <stop distance % like 0.20>,
  "tp1_pct": <tp1 gain % like 0.50>,
  "tp2_pct": <tp2 gain % like 0.90>,
  "rr": <risk reward like 2.5>,
  "hold": "<hold time like 5 min or 8 min>",

  "why": "<ONE bold sentence: exactly why to enter here right now>",
  "trigger": "<the exact condition that confirms entry: e.g. price touches 1.4220 with green candle>",

  "momentum": <0-100>,
  "strength": "STRONG" or "MEDIUM" or "WEAK",
  "volume": "HIGH" or "NORMAL" or "LOW",
  "trend_5m": "UP" or "DOWN" or "CHOPPY",
  "trend_1h": "UP" or "DOWN" or "SIDEWAYS",
  "rsi": <estimated 5m RSI>,
  "macd": "BULLISH" or "BEARISH" or "NEUTRAL",
  "ema9": <9-period EMA estimate>,
  "vwap": <VWAP estimate>,
  "support": <nearest support>,
  "resistance": <nearest resistance>,
  "btc": "UP" or "DOWN" or "FLAT",
  "buyers_pct": <order book buyers % like 53>,

  "session": <1-10 session quality>,
  "confidence": <60-99>,

  "history": [<24 objects: {"i":<0-23>,"p":<price>,"v":<vol 0-100>,"t":"<Xm ago>"}>],

  "tradeable": true or false,
  "skip_reason": "<only if tradeable=false>",
  "warning": "<one line warning or null>"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
}

// ─── Themes ───────────────────────────────────────────────────────────────────
const LIGHT = {
  bg: "#F2F5F9", white: "#FFFFFF", border: "#DDE3EC", dim: "#EBF0F7",
  text: "#0D1B2A", mid: "#3A5068", muted: "#7A90A8",
  green: "#007A3D", greenL: "#E6F4ED", greenB: "#A3D4B8",
  red: "#C8102E",   redL:   "#FDEAED", redB:   "#F0A0B0",
  blue: "#0047CC",  blueL:  "#E6EEFF", blueB:  "#99BBFF",
  amber: "#B05C00", amberL: "#FEF4E6", amberB: "#F0C888",
  shadow: "0 2px 12px rgba(0,0,0,0.08)",
};

const DARK = {
  bg: "#0D1117", white: "#161B22", border: "#30363D", dim: "#21262D",
  text: "#E6EDF3", mid: "#8B949E", muted: "#484F58",
  green: "#3FB950", greenL: "#0D2419", greenB: "#1A4731",
  red: "#F85149",   redL:   "#2D1117", redB:   "#5C1E1E",
  blue: "#58A6FF",  blueL:  "#0D1F3C", blueB:  "#1C3A6A",
  amber: "#F0B429", amberL: "#2D1E00", amberB: "#5C3D00",
  shadow: "0 2px 12px rgba(0,0,0,0.4)",
};

// ─── localStorage helpers ─────────────────────────────────────────────────────
const LS = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── Copy-to-clipboard hook ───────────────────────────────────────────────────
function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = useCallback((text, id) => {
    navigator.clipboard?.writeText(String(text)).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);
  return [copied, copy];
}

// ─── CopyBtn ─────────────────────────────────────────────────────────────────
function CopyBtn({ value, id, copied, onCopy, G }) {
  return (
    <button
      onClick={() => onCopy(value, id)}
      title="Copy"
      style={{ background:"none", border:"none", cursor:"pointer", padding:"2px 5px", color:copied===id?G.green:G.muted, fontSize:11, fontWeight:800, borderRadius:4, transition:"color 0.2s" }}
    >
      {copied === id ? "✓" : "⎘"}
    </button>
  );
}

// ─── LiveClock ────────────────────────────────────────────────────────────────
function LiveClock({ G }) {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  const h = String(t.getUTCHours()).padStart(2,"0");
  const m = String(t.getUTCMinutes()).padStart(2,"0");
  const s = String(t.getUTCSeconds()).padStart(2,"0");
  return (
    <div style={{ fontFamily:"monospace", fontSize:12, color:G.muted }}>
      {t.toLocaleTimeString()} <span style={{ color:G.blue }}>UTC {h}:{m}:{s}</span>
    </div>
  );
}

// ─── Chart ───────────────────────────────────────────────────────────────────
function Chart({ data, entry, sl, tp1, tp2, dir, G }) {
  if (!data?.length) return (
    <div style={{ height:160, display:"flex", alignItems:"center", justifyContent:"center", color:G.muted, fontSize:14 }}>
      Hit Analyze to load chart
    </div>
  );
  const ps = data.map(d => d.p);
  const mn = Math.min(...ps, sl || 99) * 0.998;
  const mx = Math.max(...ps, tp2 || 0) * 1.002;
  const lc = dir === "LONG" ? G.green : G.red;

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background:G.white, border:`1px solid ${G.border}`, borderRadius:8, padding:"6px 10px", fontSize:12, boxShadow:G.shadow }}>
        <div style={{ color:G.muted }}>{d.t}</div>
        <div style={{ fontFamily:"monospace", fontWeight:800, color:G.text }}>${d.p?.toFixed(5)}</div>
        <div style={{ fontSize:10, color:G.muted }}>Vol: {d.v}</div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={165}>
      <AreaChart data={data} margin={{ top:10, right:52, bottom:0, left:0 }}>
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={lc} stopOpacity={0.18}/>
            <stop offset="95%" stopColor={lc} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="t" tick={{ fontSize:9, fill:G.muted }} axisLine={false} tickLine={false} interval={5}/>
        <YAxis domain={[mn, mx]} tick={{ fontSize:9, fill:G.muted }} axisLine={false} tickLine={false} width={52} tickFormatter={v => `$${v.toFixed(3)}`}/>
        <Tooltip content={<Tip/>}/>
        {sl    && <ReferenceLine y={sl}    stroke={G.red}   strokeDasharray="5 3" strokeWidth={2} label={{ value:"SL",    position:"insideRight", fill:G.red,   fontSize:10, fontWeight:800 }}/>}
        {tp1   && <ReferenceLine y={tp1}   stroke={G.green} strokeDasharray="5 3" strokeWidth={2} label={{ value:"TP1",   position:"insideRight", fill:G.green, fontSize:10, fontWeight:800 }}/>}
        {tp2   && <ReferenceLine y={tp2}   stroke={G.green} strokeDasharray="3 4" strokeWidth={1} label={{ value:"TP2",   position:"insideRight", fill:G.green, fontSize:10 }}/>}
        {entry && <ReferenceLine y={entry} stroke={G.blue}  strokeDasharray="6 2" strokeWidth={2} label={{ value:"ENTER", position:"insideRight", fill:G.blue,  fontSize:10, fontWeight:800 }}/>}
        <Area type="monotone" dataKey="p" stroke={lc} strokeWidth={2.5} fill="url(#ag)" dot={false} activeDot={{ r:5, fill:lc, stroke:G.white, strokeWidth:2 }}/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Ring ─────────────────────────────────────────────────────────────────────
function Ring({ v, color, G, size = 60 }) {
  const r = (size - 8) / 2, cx = size / 2, cy = size / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={G.dim} strokeWidth={5}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${(v / 100) * c} ${c}`} strokeLinecap="round"
        style={{ transformOrigin:`${cx}px ${cy}px`, transform:"rotate(-90deg)", transition:"stroke-dasharray 1s ease" }}/>
      <text x={cx} y={cy + 5} textAnchor="middle" fill={color} fontSize={size * 0.22} fontWeight={900} fontFamily="monospace">{v}</text>
    </svg>
  );
}

// ─── RSIBar ───────────────────────────────────────────────────────────────────
function RSIBar({ v, G }) {
  if (!v) return null;
  const c = v > 70 ? G.red : v < 30 ? G.green : G.amber;
  const pct = Math.min(Math.max(v, 2), 98); // clamp thumb within bar
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
        <span style={{ fontSize:12, color:G.muted, fontWeight:600 }}>RSI 5m</span>
        <span style={{ fontFamily:"monospace", fontSize:20, fontWeight:900, color:c }}>{v?.toFixed(0)}</span>
      </div>
      <div style={{ height:8, background:`linear-gradient(90deg,${G.green},${G.amber} 50%,${G.red})`, borderRadius:4, position:"relative" }}>
        <div style={{ position:"absolute", top:-4, left:`${pct}%`, transform:"translateX(-50%)", width:16, height:16, background:G.white, borderRadius:"50%", border:`3px solid ${c}`, boxShadow:`0 0 0 2px ${c}30` }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:4, fontSize:10, color:G.muted }}>
        <span style={{ color:G.green }}>30</span>
        <span style={{ color:c, fontWeight:700 }}>{v > 70 ? "OVERBOUGHT" : v < 30 ? "OVERSOLD" : "NEUTRAL"}</span>
        <span style={{ color:G.red }}>70</span>
      </div>
    </div>
  );
}

// ─── ApiKeyGate ───────────────────────────────────────────────────────────────
function ApiKeyGate({ G, onSave }) {
  const [key, setKey]   = useState("");
  const [show, setShow] = useState(false);
  const valid = key.startsWith("sk-ant");
  return (
    <div style={{ background:G.blueL, border:`1.5px solid ${G.blueB}`, borderRadius:16, padding:"18px 16px", marginBottom:12 }}>
      <div style={{ fontSize:14, fontWeight:800, color:G.blue, marginBottom:6 }}>🔑 Anthropic API Key Required</div>
      <div style={{ fontSize:12, color:G.mid, marginBottom:12, lineHeight:1.5 }}>
        Calls are made directly from your browser. Your key is stored locally only — never sent anywhere else.
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <input
          type={show ? "text" : "password"}
          placeholder="sk-ant-..."
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === "Enter" && valid && onSave(key)}
          style={{ flex:1, background:G.white, border:`1.5px solid ${G.border}`, borderRadius:10, padding:"10px 12px", fontSize:13, fontFamily:"monospace", color:G.text }}
        />
        <button onClick={() => setShow(s => !s)} style={{ background:G.white, border:`1.5px solid ${G.border}`, borderRadius:10, padding:"0 12px", cursor:"pointer", fontSize:14 }}>
          {show ? "🙈" : "👁"}
        </button>
        <button onClick={() => valid && onSave(key)} disabled={!valid} style={{
          background: valid ? G.blue : G.dim, color: valid ? G.white : G.muted,
          border:"none", borderRadius:10, padding:"0 16px", cursor: valid ? "pointer" : "default", fontWeight:800, fontSize:13,
        }}>
          Save
        </button>
      </div>
    </div>
  );
}

// ─── PriceRow (chart levels) ─────────────────────────────────────────────────
function PriceRow({ label, value, color, copyId, copied, onCopy, G }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingBottom:9, marginBottom:9, borderBottom:`1px solid ${G.border}` }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <div style={{ width:22, height:3, background:color, borderRadius:2 }}/>
        <span style={{ fontSize:13, color:G.mid, fontWeight:700 }}>{label}</span>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:2 }}>
        <span style={{ fontFamily:"monospace", fontSize:15, fontWeight:900, color }}>${value?.toFixed(5)}</span>
        <CopyBtn value={value?.toFixed(5)} id={copyId} copied={copied} onCopy={onCopy} G={G}/>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ScalpBot() {
  const [apiKey,  setApiKey]  = useState(() => LS.get("xrp_api_key", ""));
  const [d,       setD]       = useState(null);
  const [loading, setL]       = useState(false);
  const [error,   setE]       = useState(null);
  const [auto,    setAuto]    = useState(false);
  const [cdAuto,  setCdAuto]  = useState(0);   // countdown for auto refresh
  const [cooldown,setCool]    = useState(0);   // cooldown between manual presses
  const [tab,     setTab]     = useState("signal");
  const [bal,     setBal]     = useState(() => LS.get("xrp_bal",  "1000"));
  const [risk,    setRisk]    = useState(() => LS.get("xrp_risk", "2"));
  const [log,     setLog]     = useState([]);
  const [journal, setJournal] = useState(() => LS.get("xrp_journal", []));
  const [dark,    setDark]    = useState(() => LS.get("xrp_dark", false));
  const [lastUp,  setLastUp]  = useState(null);

  const autoTimer  = useRef(null);
  const cdAutoRef  = useRef(null);
  const coolRef    = useRef(null);
  const [copied, copy] = useCopy();

  const G = dark ? DARK : LIGHT;

  // Persist settings
  useEffect(() => { LS.set("xrp_api_key", apiKey); }, [apiKey]);
  useEffect(() => { LS.set("xrp_bal",     bal);    }, [bal]);
  useEffect(() => { LS.set("xrp_risk",    risk);   }, [risk]);
  useEffect(() => { LS.set("xrp_dark",    dark);   }, [dark]);

  const addLog = useCallback((msg, type = "info") => {
    setLog(p => [{ t: new Date().toLocaleTimeString(), msg, type }, ...p].slice(0, 20));
  }, []);

  const startCooldown = useCallback((secs) => {
    setCool(secs);
    clearInterval(coolRef.current);
    coolRef.current = setInterval(() => {
      setCool(p => { if (p <= 1) { clearInterval(coolRef.current); return 0; } return p - 1; });
    }, 1000);
  }, []);

  const run = useCallback(async () => {
    if (!apiKey) { setE("Enter your Anthropic API key first"); return; }
    if (cooldown > 0) return;
    setL(true); setE(null);
    addLog("Scanning XRP 5m setup…", "info");
    try {
      const r = await fetchSignal(apiKey);
      setD(r);
      setLastUp(new Date());
      addLog(`✓ $${r.price?.toFixed(5)} · ${r.direction} · ${r.confidence}% conf`, "success");
      if (r.tradeable) {
        const entry = {
          id: Date.now(), ts: new Date().toISOString(),
          price: r.price, dir: r.direction, entry: r.entry,
          sl: r.stop_loss, tp1: r.tp1, tp2: r.tp2,
          confidence: r.confidence, rr: r.rr,
        };
        setJournal(p => { const j = [entry, ...p].slice(0, 50); LS.set("xrp_journal", j); return j; });
      }
      startCooldown(30);
    } catch (e) {
      setE(e.message);
      addLog(`✗ ${e.message}`, "error");
    } finally {
      setL(false);
    }
  }, [apiKey, addLog, cooldown, startCooldown]);

  // Auto-refresh with live countdown
  useEffect(() => {
    if (auto) {
      addLog("Auto ON · 60s refresh", "info");
      setCdAuto(60);
      autoTimer.current = setInterval(() => { run(); setCdAuto(60); }, 60000);
      cdAutoRef.current = setInterval(() => setCdAuto(p => Math.max(0, p - 1)), 1000);
    } else {
      clearInterval(autoTimer.current);
      clearInterval(cdAutoRef.current);
      setCdAuto(0);
    }
    return () => { clearInterval(autoTimer.current); clearInterval(cdAutoRef.current); };
  }, [auto, run, addLog]);

  // Position calculator (memoized)
  const { riskUSD, qty, p1, p2 } = useMemo(() => {
    const riskUSD    = parseFloat(bal  || 0) * parseFloat(risk || 0) / 100;
    const riskPerXRP = d ? Math.abs(d.price - d.stop_loss) : 0;
    const qty        = riskPerXRP > 0 ? Math.floor(riskUSD / riskPerXRP) : 0;
    const p1         = d?.tp1 ? (qty * Math.abs(d.tp1 - d.price)).toFixed(2) : "—";
    const p2         = d?.tp2 ? (qty * Math.abs(d.tp2 - d.price)).toFixed(2) : "—";
    return { riskUSD, qty, p1, p2 };
  }, [bal, risk, d]);

  const dc  = d?.direction === "LONG" ? G.green : d?.direction === "SHORT" ? G.red : G.blue;
  const dcL = d?.direction === "LONG" ? G.greenL : d?.direction === "SHORT" ? G.redL : G.blueL;
  const dcB = d?.direction === "LONG" ? G.greenB : d?.direction === "SHORT" ? G.redB : G.blueB;

  const tabs = [["signal","⚡","Signal"],["chart","📊","Chart"],["info","🔬","Analysis"],["calc","🎯","Position"],["journal","📓","Journal"]];

  const card = { background:G.white, border:`1px solid ${G.border}`, borderRadius:16, padding:"14px 16px", marginBottom:10, boxShadow:G.shadow };
  const sectionLabel = { fontSize:10, fontWeight:800, letterSpacing:2, color:G.muted, textTransform:"uppercase", marginBottom:8, display:"block" };

  const btnDisabled = loading || cooldown > 0 || !apiKey;

  return (
    <div style={{ fontFamily:"'DM Sans',system-ui,sans-serif", background:G.bg, color:G.text, minHeight:"100vh", padding:"12px", transition:"background 0.3s,color 0.3s" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box}
        input{outline:none;transition:border 0.2s}
        input:focus{border-color:${G.blue}!important;box-shadow:0 0 0 3px ${G.blueL}}
        button:active{transform:scale(0.97)}
        @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
        @keyframes up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .fade{animation:up 0.3s ease}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:${G.border}}
      `}</style>

      {/* ── Header ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontFamily:"monospace", fontSize:22, fontWeight:900, color:G.blue }}>XRP</span>
          <span style={{ background:G.greenL, color:G.green, border:`1.5px solid ${G.greenB}`, borderRadius:8, padding:"2px 8px", fontSize:11, fontWeight:800 }}>5M SCALPER</span>
          {d && <span style={{ width:8, height:8, borderRadius:"50%", background:G.green, display:"inline-block", animation:"pulse 2s infinite" }}/>}
          {auto && cdAuto > 0 && (
            <span style={{ fontFamily:"monospace", fontSize:11, color:G.amber, fontWeight:700 }}>↻ {cdAuto}s</span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <LiveClock G={G}/>
          <button onClick={() => setDark(p => !p)} style={{ background:"none", border:`1px solid ${G.border}`, borderRadius:8, padding:"3px 8px", cursor:"pointer", fontSize:15, color:G.muted }}>
            {dark ? "☀️" : "🌙"}
          </button>
          {apiKey && (
            <button
              title="Forget API key"
              onClick={() => { if (window.confirm("Remove saved API key?")) { setApiKey(""); LS.set("xrp_api_key",""); } }}
              style={{ background:"none", border:`1px solid ${G.border}`, borderRadius:8, padding:"3px 8px", cursor:"pointer", fontSize:11, color:G.muted }}
            >🔑</button>
          )}
        </div>
      </div>

      {/* ── API Key Gate ── */}
      {!apiKey && <ApiKeyGate G={G} onSave={k => setApiKey(k)}/>}

      {/* ── Price Bar ── */}
      <div style={{ ...card, marginBottom:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:3 }}>XRP / USD · LIVE</div>
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <div style={{ fontFamily:"monospace", fontSize:30, fontWeight:900, lineHeight:1 }}>
              {d ? `$${d.price?.toFixed(5)}` : <span style={{ color:G.muted }}>——</span>}
            </div>
            {d && <CopyBtn value={d.price?.toFixed(5)} id="hdr-price" copied={copied} onCopy={copy} G={G}/>}
          </div>
          {d && (
            <div style={{ display:"flex", gap:10, marginTop:5 }}>
              <span style={{ fontSize:13, fontWeight:700, color:d.change1h >= 0 ? G.green : G.red }}>
                {d.change1h >= 0 ? "▲" : "▼"} {Math.abs(d.change1h || 0).toFixed(2)}% 1h
              </span>
              <span style={{ fontSize:12, color:G.muted }}>
                {d.change24h >= 0 ? "▲" : "▼"} {Math.abs(d.change24h || 0).toFixed(2)}% 24h
              </span>
            </div>
          )}
          {lastUp && <div style={{ fontSize:10, color:G.muted, marginTop:3 }}>Updated {lastUp.toLocaleTimeString()}</div>}
        </div>
        {d && (
          <div style={{ textAlign:"center" }}>
            <Ring v={d.confidence} color={d.confidence >= 80 ? G.green : d.confidence >= 65 ? G.amber : G.red} size={62} G={G}/>
            <div style={{ fontSize:10, color:G.muted, marginTop:2, fontWeight:700 }}>CONFIDENCE</div>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:3, marginBottom:10, background:G.white, borderRadius:14, padding:4, border:`1px solid ${G.border}`, boxShadow:G.shadow }}>
        {tabs.map(([id, icon, tabLabel]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            background: tab === id ? G.bg : "transparent",
            border: tab === id ? `1px solid ${G.border}` : "1px solid transparent",
            borderRadius:10, padding:"6px 2px",
            color: tab === id ? G.text : G.muted,
            fontFamily:"DM Sans", fontSize:10, fontWeight: tab === id ? 800 : 500, cursor:"pointer",
          }}>
            <div style={{ fontSize:15 }}>{icon}</div>
            <div>{tabLabel}</div>
          </button>
        ))}
      </div>

      {/* ══════════ SIGNAL TAB ══════════ */}
      {tab === "signal" && (
        <div className="fade">
          {d && d.tradeable ? (
            <div style={{ background:dcL, border:`2.5px solid ${dcB}`, borderRadius:20, padding:"18px 16px", marginBottom:10, boxShadow:`0 4px 24px ${dc}20` }}>
              {/* Direction header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:dc, letterSpacing:2, marginBottom:4 }}>SCALP SIGNAL</div>
                  <div style={{ fontFamily:"monospace", fontSize:48, fontWeight:900, color:dc, lineHeight:1 }}>
                    {d.direction === "LONG" ? "▲ LONG" : "▼ SHORT"}
                  </div>
                  <div style={{ fontSize:14, color:G.mid, marginTop:8, lineHeight:1.5, fontWeight:600 }}>{d.why}</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"monospace", fontSize:13, fontWeight:700, color:G.muted, marginBottom:4 }}>HOLD</div>
                  <div style={{ fontFamily:"monospace", fontSize:18, fontWeight:900, color:dc }}>{d.hold}</div>
                </div>
              </div>

              {/* Trigger */}
              <div style={{ background:G.white+"cc", borderRadius:12, padding:"10px 14px", marginBottom:14, border:`1px solid ${dcB}` }}>
                <div style={{ fontSize:10, fontWeight:800, color:G.muted, letterSpacing:1.5, marginBottom:4 }}>ENTRY TRIGGER</div>
                <div style={{ fontSize:14, fontWeight:700, color:G.text, lineHeight:1.5 }}>⚡ {d.trigger}</div>
              </div>

              {/* Entry price — big */}
              <div style={{ background:G.white, borderRadius:14, padding:"14px 16px", marginBottom:10, border:`2px solid ${dc}40`, textAlign:"center" }}>
                <div style={{ fontSize:11, fontWeight:800, color:dc, letterSpacing:2, marginBottom:4 }}>ENTER AT</div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  <div style={{ fontFamily:"monospace", fontSize:38, fontWeight:900, color:dc, lineHeight:1 }}>${d.entry?.toFixed(5)}</div>
                  <CopyBtn value={d.entry?.toFixed(5)} id="entry" copied={copied} onCopy={copy} G={G}/>
                </div>
                <div style={{ fontSize:12, color:G.muted, marginTop:4 }}>
                  {d.direction === "LONG"
                    ? `${((d.entry - d.price) / d.price * 100).toFixed(3)}% from current`
                    : `${((d.price - d.entry) / d.price * 100).toFixed(3)}% from current`}
                </div>
              </div>

              {/* SL / TP1 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                <div style={{ background:G.redL, border:`1.5px solid ${G.redB}`, borderRadius:12, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, fontWeight:800, color:G.red, marginBottom:4 }}>🔴 STOP LOSS</div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:900, color:G.red }}>${d.stop_loss?.toFixed(5)}</div>
                    <CopyBtn value={d.stop_loss?.toFixed(5)} id="sl" copied={copied} onCopy={copy} G={G}/>
                  </div>
                  <div style={{ fontSize:12, color:G.red, fontWeight:700, marginTop:2 }}>-{d.stop_pct?.toFixed(2)}%</div>
                </div>
                <div style={{ background:G.greenL, border:`1.5px solid ${G.greenB}`, borderRadius:12, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, fontWeight:800, color:G.green, marginBottom:4 }}>🟢 TARGET 1</div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:900, color:G.green }}>${d.tp1?.toFixed(5)}</div>
                    <CopyBtn value={d.tp1?.toFixed(5)} id="tp1" copied={copied} onCopy={copy} G={G}/>
                  </div>
                  <div style={{ fontSize:12, color:G.green, fontWeight:700, marginTop:2 }}>+{d.tp1_pct?.toFixed(2)}%</div>
                </div>
              </div>

              {/* TP2 */}
              <div style={{ background:G.greenL, border:`1px solid ${G.greenB}`, borderRadius:12, padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:G.green, marginBottom:2 }}>🟢 TARGET 2 — LET IT RUN</div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ fontFamily:"monospace", fontSize:18, fontWeight:900, color:G.green }}>${d.tp2?.toFixed(5)}</div>
                    <CopyBtn value={d.tp2?.toFixed(5)} id="tp2" copied={copied} onCopy={copy} G={G}/>
                  </div>
                  <div style={{ fontSize:12, color:G.green, fontWeight:700, marginTop:2 }}>+{d.tp2_pct?.toFixed(2)}%</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:11, color:G.muted }}>R:R Ratio</div>
                  <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:900, color:d.rr >= 2 ? G.green : G.amber }}>1:{d.rr}</div>
                </div>
              </div>
            </div>

          ) : d && !d.tradeable ? (
            <div style={{ ...card, background:G.amberL, border:`2px solid ${G.amberB}`, textAlign:"center", padding:28 }}>
              <div style={{ fontSize:40, marginBottom:8 }}>⏸</div>
              <div style={{ fontSize:24, fontWeight:900, color:G.amber }}>WAIT</div>
              <div style={{ fontSize:14, color:G.mid, marginTop:8, lineHeight:1.5 }}>{d.skip_reason}</div>
            </div>
          ) : (
            <div style={{ ...card, textAlign:"center", padding:36 }}>
              <div style={{ fontSize:48, marginBottom:10 }}>⚡</div>
              <div style={{ fontSize:20, fontWeight:800, color:G.mid }}>Ready to find your trade</div>
              <div style={{ fontSize:14, color:G.muted, marginTop:4 }}>AI scans live XRP 5m setup</div>
            </div>
          )}

          {/* Market pulse strip */}
          {d && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:10 }}>
              {[
                ["MOMENTUM", `${d.momentum}%`,  d.momentum >= 65 ? G.green : d.momentum <= 35 ? G.red : G.amber],
                ["VOLUME",   d.volume,           d.volume === "HIGH" ? G.green : d.volume === "LOW" ? G.red : G.amber],
                ["SESSION",  `${d.session}/10`,  d.session >= 7 ? G.green : d.session >= 5 ? G.amber : G.red],
                ["BTC",      d.btc,              d.btc === "UP" ? G.green : d.btc === "DOWN" ? G.red : G.muted],
              ].map(([l, v, c]) => (
                <div key={l} style={{ background:G.white, border:`1px solid ${G.border}`, borderRadius:12, padding:"9px 10px", textAlign:"center", boxShadow:G.shadow }}>
                  <div style={{ fontSize:9, color:G.muted, fontWeight:700, letterSpacing:1 }}>{l}</div>
                  <div style={{ fontSize:15, fontWeight:900, color:c, fontFamily:"monospace", marginTop:2 }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Order book */}
          {d && (
            <div style={card}>
              <span style={sectionLabel}>ORDER BOOK PRESSURE</span>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:14, fontWeight:800, marginBottom:6 }}>
                <span style={{ color:G.green }}>BUYERS {d.buyers_pct}%</span>
                <span style={{ color:G.red }}>SELLERS {100 - d.buyers_pct}%</span>
              </div>
              <div style={{ height:14, borderRadius:8, overflow:"hidden", display:"flex" }}>
                <div style={{ width:`${d.buyers_pct}%`, background:G.green, transition:"width 1s ease" }}/>
                <div style={{ flex:1, background:G.red }}/>
              </div>
              <div style={{ fontSize:12, color:G.mid, marginTop:8, fontWeight:600 }}>
                {d.buyers_pct >= 55
                  ? "💪 Buyers dominate — favors LONG"
                  : d.buyers_pct <= 45
                    ? "⚡ Sellers dominate — favors SHORT"
                    : "⚖️ Balanced — wait for momentum"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════ CHART TAB ══════════ */}
      {tab === "chart" && (
        <div className="fade">
          <div style={card}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <span style={sectionLabel}>5M CHART · LAST 2H</span>
              {d && <span style={{ fontSize:13, fontWeight:800, color:d.trend_5m === "UP" ? G.green : d.trend_5m === "DOWN" ? G.red : G.amber }}>
                {d.trend_5m === "UP" ? "▲ UP" : d.trend_5m === "DOWN" ? "▼ DOWN" : "↔ CHOPPY"}
              </span>}
            </div>
            <Chart data={d?.history} entry={d?.entry} sl={d?.stop_loss} tp1={d?.tp1} tp2={d?.tp2} dir={d?.direction} G={G}/>
          </div>
          {d && (
            <div style={card}>
              <span style={sectionLabel}>LEVELS ON CHART</span>
              {[
                ["ENTER",                                              d.entry,       G.blue],
                [d.direction === "LONG" ? "▼ STOP LOSS" : "▲ STOP LOSS", d.stop_loss, G.red],
                ["▲ TARGET 1",                                         d.tp1,        G.green],
                ["▲ TARGET 2",                                         d.tp2,        "#006633"],
                ["SUPPORT",                                            d.support,    G.muted],
                ["RESISTANCE",                                         d.resistance, G.muted],
              ].map(([label, value, color]) => (
                <PriceRow key={label} label={label} value={value} color={color} copyId={`lvl-${label}`} copied={copied} onCopy={copy} G={G}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════ ANALYSIS TAB ══════════ */}
      {tab === "info" && (
        <div className="fade">
          {d ? (
            <>
              <div style={card}>
                <span style={sectionLabel}>INDICATORS</span>
                <RSIBar v={d.rsi} G={G}/>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:14 }}>
                  {[
                    ["MACD",     d.macd,                       d.macd === "BULLISH" ? G.green : d.macd === "BEARISH" ? G.red : G.amber],
                    ["TREND 1H", d.trend_1h,                   d.trend_1h === "UP"  ? G.green : d.trend_1h === "DOWN" ? G.red : G.amber],
                    ["EMA 9",    `$${d.ema9?.toFixed(4)}`,     G.blue],
                    ["VWAP",     `$${d.vwap?.toFixed(4)}`,     G.mid],
                    ["SUPPORT",  `$${d.support?.toFixed(4)}`,   G.green],
                    ["RESIST",   `$${d.resistance?.toFixed(4)}`, G.red],
                  ].map(([l, v, c]) => (
                    <div key={l} style={{ background:G.dim, borderRadius:12, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:G.muted, fontWeight:700, marginBottom:3 }}>{l}</div>
                      <div style={{ fontSize:16, fontWeight:900, color:c, fontFamily:"monospace" }}>{v || "—"}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={card}>
                <span style={sectionLabel}>SIGNAL STRENGTH</span>
                <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                  <Ring v={d.confidence} color={d.confidence >= 80 ? G.green : d.confidence >= 65 ? G.amber : G.red} size={70} G={G}/>
                  <div>
                    <div style={{ fontSize:18, fontWeight:900, color:d.strength === "STRONG" ? G.green : d.strength === "MEDIUM" ? G.amber : G.red }}>
                      {d.strength} SETUP
                    </div>
                    <div style={{ fontSize:13, color:G.mid, marginTop:4, lineHeight:1.5 }}>
                      {d.confidence >= 80 ? "High-probability — enter with size" : "Setup present — use standard size"}
                    </div>
                  </div>
                </div>
              </div>

              <div style={card}>
                <span style={sectionLabel}>SESSION QUALITY</span>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <span style={{ fontSize:15, fontWeight:800, color:d.session >= 7 ? G.green : d.session >= 5 ? G.amber : G.red }}>
                    {d.session >= 8 ? "🔥 PRIME TIME" : d.session >= 6 ? "✅ ACTIVE" : d.session >= 4 ? "⚠️ SLOW" : "🚫 DEAD"}
                  </span>
                  <span style={{ fontFamily:"monospace", fontSize:22, fontWeight:900, color:d.session >= 7 ? G.green : d.session >= 5 ? G.amber : G.red }}>{d.session}/10</span>
                </div>
                <div style={{ height:10, background:G.dim, borderRadius:5, overflow:"hidden" }}>
                  <div style={{ width:`${d.session * 10}%`, height:"100%", background:d.session >= 7 ? G.green : d.session >= 5 ? G.amber : G.red, borderRadius:5, transition:"width 1s" }}/>
                </div>
              </div>
            </>
          ) : <div style={{ textAlign:"center", padding:40, color:G.muted, fontSize:15 }}>Run analysis first</div>}
        </div>
      )}

      {/* ══════════ POSITION CALC TAB ══════════ */}
      {tab === "calc" && (
        <div className="fade">
          <div style={card}>
            <span style={sectionLabel}>POSITION SIZE CALCULATOR</span>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
              {[["Portfolio ($)", bal, setBal], ["Risk %", risk, setRisk]].map(([l, v, fn]) => (
                <div key={l}>
                  <div style={{ fontSize:12, color:G.muted, fontWeight:700, marginBottom:5 }}>{l}</div>
                  <input value={v} onChange={e => fn(e.target.value)} type="number"
                    style={{ width:"100%", background:G.bg, border:`1.5px solid ${G.border}`, borderRadius:10, padding:"10px 12px", fontSize:16, fontFamily:"monospace", fontWeight:700, color:G.text }}/>
                </div>
              ))}
            </div>
            {d ? (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[
                  ["$ at Risk",     `$${riskUSD.toFixed(0)}`,       G.red],
                  ["XRP to Buy",    qty.toLocaleString(),            G.blue],
                  ["Profit at TP1", `+$${p1}`,                       G.green],
                  ["Profit at TP2", `+$${p2}`,                       G.green],
                  ["Position $",    `$${(qty * d.price).toFixed(0)}`, G.text],
                  ["R : R",         `1 : ${d.rr}`,                   d.rr >= 2 ? G.green : G.amber],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background:G.dim, borderRadius:12, padding:"10px 12px" }}>
                    <div style={{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:2 }}>{l}</div>
                    <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:900, color:c }}>{v}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign:"center", color:G.muted, padding:20, fontSize:14 }}>Run analysis to calculate</div>
            )}
          </div>

          <div style={card}>
            <span style={sectionLabel}>SCALPER'S RULES</span>
            {[
              [G.red,   "ALWAYS set SL before entering. No SL = gambling."],
              [G.green, "TP1 first (50%). Lock profit. Let TP2 run."],
              [G.blue,  "Only enter on the TRIGGER — not before."],
              [G.amber, "Strong setup = enter with size. Weak = skip."],
              [G.red,   "CHOPPY market = sit on hands. Wait."],
              [G.green, "With 5X leverage: 1% move = 5% gain. Respect it."],
              [G.mid,   "Session score < 5? Don't trade. Come back later."],
              [G.blue,  "BTC opposite direction? Reduce position size."],
            ].map(([c, t], i) => (
              <div key={i} style={{ display:"flex", gap:10, paddingBottom:10, marginBottom:10, borderBottom:`1px solid ${G.border}` }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:c+"15", border:`1.5px solid ${c}40`, color:c, fontSize:12, fontWeight:900, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{i + 1}</div>
                <div style={{ fontSize:13, color:G.mid, lineHeight:1.5, fontWeight:500 }}>{t}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════ JOURNAL TAB ══════════ */}
      {tab === "journal" && (
        <div className="fade">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <span style={sectionLabel}>SIGNAL HISTORY ({journal.length})</span>
            {journal.length > 0 && (
              <button onClick={() => { if (window.confirm("Clear all journal entries?")) { setJournal([]); LS.set("xrp_journal", []); } }}
                style={{ background:"none", border:`1px solid ${G.redB}`, borderRadius:8, padding:"4px 10px", color:G.red, fontSize:11, fontWeight:700, cursor:"pointer" }}>
                Clear
              </button>
            )}
          </div>
          {journal.length === 0 ? (
            <div style={{ textAlign:"center", padding:40, color:G.muted, fontSize:15 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📓</div>
              No signals recorded yet
            </div>
          ) : journal.map(j => (
            <div key={j.id} style={{ ...card, padding:"12px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontFamily:"monospace", fontSize:16, fontWeight:900, color:j.dir === "LONG" ? G.green : G.red }}>
                    {j.dir === "LONG" ? "▲" : "▼"} {j.dir}
                  </span>
                  <span style={{
                    fontSize:11, fontWeight:700, borderRadius:6, padding:"1px 7px",
                    background: j.confidence >= 80 ? G.greenL : j.confidence >= 65 ? G.amberL : G.redL,
                    color:      j.confidence >= 80 ? G.green  : j.confidence >= 65 ? G.amber  : G.red,
                    border:`1px solid ${j.confidence >= 80 ? G.greenB : j.confidence >= 65 ? G.amberB : G.redB}`,
                  }}>
                    {j.confidence}%
                  </span>
                </div>
                <span style={{ fontSize:11, color:G.muted }}>{new Date(j.ts).toLocaleString()}</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
                {[["ENTRY", j.entry, G.blue], ["SL", j.sl, G.red], ["TP1", j.tp1, G.green]].map(([l, v, c]) => (
                  <div key={l} style={{ background:G.dim, borderRadius:8, padding:"6px 8px" }}>
                    <div style={{ fontSize:9, color:G.muted, fontWeight:700 }}>{l}</div>
                    <div style={{ fontFamily:"monospace", fontSize:12, fontWeight:900, color:c }}>${v?.toFixed(4)}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:11, color:G.muted, marginTop:6 }}>
                R:R 1:{j.rr} · Price at signal: ${j.price?.toFixed(5)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warning */}
      {d?.warning && (
        <div style={{ background:G.amberL, border:`1.5px solid ${G.amberB}`, borderRadius:12, padding:"10px 14px", marginTop:4, fontSize:13, color:G.amber, fontWeight:700 }}>
          ⚠️ {d.warning}
        </div>
      )}

      {/* ── Buttons ── */}
      <div style={{ display:"flex", gap:10, marginTop:12 }}>
        <button onClick={run} disabled={btnDisabled} style={{
          flex:1,
          background: btnDisabled ? G.white : `linear-gradient(135deg,${G.blue},#0035AA)`,
          color:       btnDisabled ? G.blue  : G.white,
          border:      btnDisabled ? `2px solid ${G.blue}40` : "none",
          borderRadius:14, padding:"15px 0",
          fontFamily:"DM Sans", fontWeight:900, fontSize:16,
          cursor: btnDisabled ? "default" : "pointer",
          boxShadow: btnDisabled ? "none" : `0 4px 20px ${G.blue}30`,
          transition:"all 0.2s",
        }}>
          {loading ? "⏳ Scanning…" : cooldown > 0 ? `⏱ Wait ${cooldown}s` : "⚡ Analyze Now"}
        </button>
        <button onClick={() => setAuto(p => !p)} disabled={!apiKey} style={{
          background: auto ? G.greenL : G.white,
          color:       auto ? G.green  : G.muted,
          border:`2px solid ${auto ? G.greenB : G.border}`,
          borderRadius:14, padding:"15px 14px",
          fontFamily:"DM Sans", cursor:"pointer", fontSize:13, fontWeight:800, boxShadow:G.shadow,
          opacity: apiKey ? 1 : 0.5, transition:"all 0.2s",
        }}>
          {auto ? "⏹ Stop" : "▶ Auto"}
        </button>
      </div>

      {/* Log */}
      <div style={{ background:G.white, border:`1px solid ${G.border}`, borderRadius:12, padding:10, marginTop:10, maxHeight:100, overflowY:"auto", boxShadow:G.shadow }}>
        {log.length === 0
          ? <div style={{ fontSize:13, color:G.muted }}>Log — press Analyze to start</div>
          : log.map((l, i) => (
            <div key={i} style={{ fontSize:11, marginBottom:2, color:l.type === "success" ? G.green : l.type === "error" ? G.red : G.muted }}>
              <span style={{ color:G.border }}>[{l.t}]</span> {l.msg}
            </div>
          ))}
      </div>

      {error && (
        <div style={{ background:G.redL, border:`1.5px solid ${G.redB}`, borderRadius:12, padding:"10px 14px", marginTop:8, fontSize:13, color:G.red, fontWeight:700 }}>
          ❌ {error}
          {error.includes("API key") && (
            <span style={{ marginLeft:8, textDecoration:"underline", cursor:"pointer" }} onClick={() => setApiKey("")}> Re-enter key</span>
          )}
        </div>
      )}

      <div style={{ fontSize:10, color:G.muted, textAlign:"center", marginTop:12, lineHeight:1.8 }}>
        Educational tool only · Always use stop losses · Trade responsibly<br/>
        <span style={{ color:G.border }}>Not financial advice · Past signals do not guarantee future results</span>
      </div>
    </div>
  );
}
