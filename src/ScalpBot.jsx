import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const INTERVAL = 60;

async function fetchSignal(apiKey) {
  const now = new Date();
  const prompt = `You are an elite aggressive XRP 5-minute scalp trader. You are BOLD and DECISIVE.

Current UTC: ${now.getUTCHours()}:${String(now.getUTCMinutes()).padStart(2,"0")}

Search the web RIGHT NOW for:
1. XRP exact current price
2. Short-term price momentum (last 30-60 min)
3. Bitcoin direction right now
4. XRP order book pressure (buyers vs sellers)
5. Any news in last 2 hours affecting XRP

Find the single best 5-minute scalp entry RIGHT NOW. Be aggressive. Only return WAIT if the market is completely dead.

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "price": <exact current XRP price 5 decimals>,
  "change1h": <1h % change>,
  "change24h": <24h % change>,
  "direction": "LONG" or "SHORT",
  "entry": <precise entry price>,
  "stop_loss": <tight stop max 0.25% away>,
  "tp1": <first exit 0.4-0.6% away>,
  "tp2": <second exit 0.8-1.2% away>,
  "stop_pct": <stop distance %>,
  "tp1_pct": <tp1 gain %>,
  "tp2_pct": <tp2 gain %>,
  "rr": <risk reward like 2.5>,
  "hold": "<hold time like 5 min>",
  "why": "<ONE bold sentence>",
  "trigger": "<exact entry condition>",
  "momentum": <0-100>,
  "strength": "STRONG" or "MEDIUM" or "WEAK",
  "volume": "HIGH" or "NORMAL" or "LOW",
  "trend_5m": "UP" or "DOWN" or "CHOPPY",
  "trend_1h": "UP" or "DOWN" or "SIDEWAYS",
  "rsi": <5m RSI>,
  "macd": "BULLISH" or "BEARISH" or "NEUTRAL",
  "ema9": <9-period EMA>,
  "vwap": <VWAP>,
  "support": <nearest support>,
  "resistance": <nearest resistance>,
  "btc": "UP" or "DOWN" or "FLAT",
  "buyers_pct": <order book buyers %>,
  "session": <1-10>,
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

// ─── Design tokens ────────────────────────────────────────────────────────────
const G = {
  bg:       "#060A14",
  panel:    "rgba(255,255,255,0.04)",
  panelHov: "rgba(255,255,255,0.06)",
  border:   "rgba(255,255,255,0.08)",
  borderHi: "rgba(255,255,255,0.15)",
  text:     "#F0F4FF",
  mid:      "#9BAACB",
  muted:    "#4A5C7A",
  green:    "#00E5A0",
  greenL:   "rgba(0,229,160,0.1)",
  greenB:   "rgba(0,229,160,0.28)",
  red:      "#FF4D72",
  redL:     "rgba(255,77,114,0.1)",
  redB:     "rgba(255,77,114,0.28)",
  blue:     "#4DABFF",
  blueL:    "rgba(77,171,255,0.1)",
  blueB:    "rgba(77,171,255,0.28)",
  amber:    "#FFB800",
  amberL:   "rgba(255,184,0,0.1)",
  amberB:   "rgba(255,184,0,0.28)",
  shadow:   "0 8px 40px rgba(0,0,0,0.6)",
};

const card = {
  background: G.panel,
  border: `1px solid ${G.border}`,
  borderRadius: 20,
  padding: "16px 18px",
  marginBottom: 10,
  boxShadow: G.shadow,
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
};
const label = {
  fontSize: 10, fontWeight: 800, letterSpacing: 2,
  color: G.muted, textTransform: "uppercase", marginBottom: 10, display: "block",
};

// ─── Storage ─────────────────────────────────────────────────────────────────
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── useCopy ─────────────────────────────────────────────────────────────────
function useCopy() {
  const [id, setId] = useState(null);
  const copy = useCallback((text, copyId) => {
    navigator.clipboard?.writeText(String(text)).then(() => { setId(copyId); setTimeout(() => setId(null), 1400); });
  }, []);
  return [id, copy];
}

// ─── CopyBtn ─────────────────────────────────────────────────────────────────
function CopyBtn({ value, id, copied, onCopy }) {
  const ok = copied === id;
  return (
    <button onClick={() => onCopy(value, id)} title="Copy"
      style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px",
        color: ok ? G.green : G.muted, fontSize: 12, fontWeight: 700, borderRadius: 4,
        transition: "color 0.2s", lineHeight: 1 }}>
      {ok ? "✓" : "⎘"}
    </button>
  );
}

// ─── Countdown Ring ───────────────────────────────────────────────────────────
function CountdownRing({ secs, total = INTERVAL, loading }) {
  const size = 52, stroke = 4, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = loading ? 1 : secs / total;
  const color = secs > 20 ? G.green : secs > 8 ? G.amber : G.red;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.9s linear, stroke 0.3s" }}/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", fontFamily: "monospace", fontSize: 13, fontWeight: 900, color }}>
        {loading ? <span style={{ fontSize: 16, animation: "spin 1s linear infinite", display: "inline-block" }}>↻</span> : secs}
      </div>
    </div>
  );
}

// ─── LiveClock ────────────────────────────────────────────────────────────────
function LiveClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return (
    <span style={{ fontFamily: "monospace", fontSize: 11, color: G.muted }}>
      {String(t.getUTCHours()).padStart(2,"0")}:{String(t.getUTCMinutes()).padStart(2,"0")}:{String(t.getUTCSeconds()).padStart(2,"0")} UTC
    </span>
  );
}

// ─── Chart ────────────────────────────────────────────────────────────────────
function Chart({ data, entry, sl, tp1, tp2, dir }) {
  if (!data?.length) return (
    <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center",
      color: G.muted, fontSize: 13 }}>Chart loads after first scan</div>
  );
  const ps = data.map(d => d.p);
  const mn = Math.min(...ps, sl || 99) * 0.9978;
  const mx = Math.max(...ps, tp2 || 0) * 1.0022;
  const lc = dir === "LONG" ? G.green : G.red;

  const Tip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background: "rgba(6,10,20,0.95)", border: `1px solid ${G.border}`,
        borderRadius: 10, padding: "8px 12px", fontSize: 12, boxShadow: G.shadow }}>
        <div style={{ color: G.muted, marginBottom: 2 }}>{d.t}</div>
        <div style={{ fontFamily: "monospace", fontWeight: 900, color: G.text, fontSize: 14 }}>${d.p?.toFixed(5)}</div>
        <div style={{ fontSize: 10, color: G.muted }}>vol {d.v}</div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={170}>
      <AreaChart data={data} margin={{ top: 10, right: 58, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={lc} stopOpacity={0.25}/>
            <stop offset="95%" stopColor={lc} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="t" tick={{ fontSize: 9, fill: G.muted }} axisLine={false} tickLine={false} interval={5}/>
        <YAxis domain={[mn, mx]} tick={{ fontSize: 9, fill: G.muted }} axisLine={false} tickLine={false}
          width={56} tickFormatter={v => `$${v.toFixed(3)}`}/>
        <Tooltip content={<Tip/>}/>
        {sl    && <ReferenceLine y={sl}    stroke={G.red}   strokeDasharray="5 3" strokeWidth={1.5} label={{ value:"SL",    position:"insideRight", fill:G.red,   fontSize:9, fontWeight:800 }}/>}
        {tp1   && <ReferenceLine y={tp1}   stroke={G.green} strokeDasharray="5 3" strokeWidth={1.5} label={{ value:"TP1",   position:"insideRight", fill:G.green, fontSize:9, fontWeight:800 }}/>}
        {tp2   && <ReferenceLine y={tp2}   stroke={G.green} strokeDasharray="3 4" strokeWidth={1}   label={{ value:"TP2",   position:"insideRight", fill:G.green, fontSize:9 }}/>}
        {entry && <ReferenceLine y={entry} stroke={G.blue}  strokeDasharray="6 2" strokeWidth={2}   label={{ value:"ENTRY", position:"insideRight", fill:G.blue,  fontSize:9, fontWeight:800 }}/>}
        <Area type="monotone" dataKey="p" stroke={lc} strokeWidth={2.5} fill="url(#cg)" dot={false}
          activeDot={{ r: 5, fill: lc, stroke: G.bg, strokeWidth: 2 }}/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Ring ─────────────────────────────────────────────────────────────────────
function Ring({ v, color, size = 64 }) {
  const r = (size - 8) / 2, cx = size / 2, cy = size / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${(v/100)*c} ${c}`} strokeLinecap="round"
        style={{ transformOrigin:`${cx}px ${cy}px`, transform:"rotate(-90deg)", transition:"stroke-dasharray 1s ease" }}/>
      <text x={cx} y={cy+5} textAnchor="middle" fill={color} fontSize={size*0.22} fontWeight={900} fontFamily="monospace">{v}</text>
    </svg>
  );
}

// ─── RSIBar ───────────────────────────────────────────────────────────────────
function RSIBar({ v }) {
  if (!v) return null;
  const c = v > 70 ? G.red : v < 30 ? G.green : G.amber;
  const pct = Math.min(Math.max(v, 2), 98);
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
        <span style={{ fontSize:12, color:G.muted, fontWeight:600 }}>RSI 5m</span>
        <span style={{ fontFamily:"monospace", fontSize:22, fontWeight:900, color:c }}>{v.toFixed(0)}</span>
      </div>
      <div style={{ height:6, background:`linear-gradient(90deg,${G.green},${G.amber} 50%,${G.red})`,
        borderRadius:3, position:"relative", opacity:0.8 }}>
        <div style={{ position:"absolute", top:-5, left:`${pct}%`, transform:"translateX(-50%)",
          width:16, height:16, background:G.bg, borderRadius:"50%", border:`3px solid ${c}`,
          boxShadow:`0 0 8px ${c}80` }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, fontSize:10, color:G.muted }}>
        <span style={{ color:G.green }}>30 OS</span>
        <span style={{ color:c, fontWeight:800 }}>{v>70?"OVERBOUGHT":v<30?"OVERSOLD":"NEUTRAL"}</span>
        <span style={{ color:G.red }}>OB 70</span>
      </div>
    </div>
  );
}

// ─── ApiKeyGate ───────────────────────────────────────────────────────────────
function ApiKeyGate({ onSave }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const valid = key.startsWith("sk-ant");
  return (
    <div style={{ ...card, background:`linear-gradient(135deg, rgba(77,171,255,0.08), rgba(77,171,255,0.03))`,
      border:`1px solid ${G.blueB}`, marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
        <span style={{ fontSize:24 }}>🔑</span>
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:G.blue }}>Anthropic API Key Required</div>
          <div style={{ fontSize:11, color:G.muted, marginTop:2 }}>Stored locally only — never leaves your browser</div>
        </div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <input type={show?"text":"password"} placeholder="sk-ant-api03-..."
          value={key} onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key==="Enter" && valid && onSave(key)}
          style={{ flex:1, background:"rgba(255,255,255,0.05)", border:`1px solid ${valid?G.blueB:G.border}`,
            borderRadius:12, padding:"12px 14px", fontSize:13, fontFamily:"monospace",
            color:G.text, outline:"none", transition:"border 0.2s" }}/>
        <button onClick={() => setShow(s=>!s)}
          style={{ background:"rgba(255,255,255,0.06)", border:`1px solid ${G.border}`,
            borderRadius:12, padding:"0 14px", cursor:"pointer", fontSize:16 }}>
          {show?"🙈":"👁"}
        </button>
        <button onClick={() => valid && onSave(key)} disabled={!valid}
          style={{ background:valid?G.blue:"rgba(255,255,255,0.05)",
            color:valid?"#fff":G.muted, border:"none",
            borderRadius:12, padding:"0 20px", cursor:valid?"pointer":"default",
            fontWeight:800, fontSize:13, boxShadow:valid?`0 0 20px ${G.blue}50`:"none",
            transition:"all 0.2s" }}>
          Confirm
        </button>
      </div>
    </div>
  );
}

// ─── PriceRow ─────────────────────────────────────────────────────────────────
function PriceRow({ lbl, value, color, cid, copied, onCopy }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"10px 0", borderBottom:`1px solid ${G.border}` }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <div style={{ width:18, height:3, background:color, borderRadius:2,
          boxShadow:`0 0 6px ${color}80` }}/>
        <span style={{ fontSize:12, color:G.mid, fontWeight:700 }}>{lbl}</span>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <span style={{ fontFamily:"monospace", fontSize:14, fontWeight:900, color }}>
          ${value?.toFixed(5)}
        </span>
        <CopyBtn value={value?.toFixed(5)} id={cid} copied={copied} onCopy={onCopy}/>
      </div>
    </div>
  );
}

// ─── StatChip ─────────────────────────────────────────────────────────────────
function StatChip({ label: l, value, color }) {
  return (
    <div style={{ background:G.panel, border:`1px solid ${G.border}`, borderRadius:14,
      padding:"10px 12px", textAlign:"center" }}>
      <div style={{ fontSize:9, color:G.muted, fontWeight:700, letterSpacing:1.5, marginBottom:4 }}>{l}</div>
      <div style={{ fontSize:14, fontWeight:900, color, fontFamily:"monospace" }}>{value}</div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ScalpBot() {
  const [apiKey,  setApiKey]  = useState(() => LS.get("xrp_api_key", ""));
  const [d,       setD]       = useState(null);
  const [loading, setL]       = useState(false);
  const [error,   setE]       = useState(null);
  const [countdown, setCd]    = useState(INTERVAL);
  const [tab,     setTab]     = useState("signal");
  const [bal,     setBal]     = useState(() => LS.get("xrp_bal",  "1000"));
  const [risk,    setRisk]    = useState(() => LS.get("xrp_risk", "2"));
  const [log,     setLog]     = useState([]);
  const [journal, setJournal] = useState(() => LS.get("xrp_journal", []));
  const [lastUp,  setLastUp]  = useState(null);
  const [cooldown,setCool]    = useState(0);

  const runRef    = useRef(null);
  const coolRef   = useRef(null);
  const [copied, copy] = useCopy();

  useEffect(() => { LS.set("xrp_api_key", apiKey); }, [apiKey]);
  useEffect(() => { LS.set("xrp_bal",     bal);    }, [bal]);
  useEffect(() => { LS.set("xrp_risk",    risk);   }, [risk]);

  const addLog = useCallback((msg, type = "info") => {
    setLog(p => [{ t: new Date().toLocaleTimeString(), msg, type }, ...p].slice(0, 25));
  }, []);

  const startCooldown = useCallback(secs => {
    setCool(secs);
    clearInterval(coolRef.current);
    coolRef.current = setInterval(() => {
      setCool(p => { if (p <= 1) { clearInterval(coolRef.current); return 0; } return p - 1; });
    }, 1000);
  }, []);

  const run = useCallback(async (silent = false) => {
    if (!apiKey) return;
    if (loading) return;
    setL(true);
    setE(null);
    if (!silent) addLog("Scanning XRP 5m…", "info");
    try {
      const r = await fetchSignal(apiKey);
      setD(r);
      setLastUp(new Date());
      setCd(INTERVAL);
      addLog(`✓ $${r.price?.toFixed(5)} · ${r.direction} · ${r.confidence}% conf`, "success");
      if (r.tradeable) {
        const entry = { id:Date.now(), ts:new Date().toISOString(), price:r.price, dir:r.direction,
          entry:r.entry, sl:r.stop_loss, tp1:r.tp1, tp2:r.tp2, confidence:r.confidence, rr:r.rr };
        setJournal(p => { const j=[entry,...p].slice(0,50); LS.set("xrp_journal",j); return j; });
      }
      startCooldown(20);
    } catch(e) {
      setE(e.message);
      addLog(`✗ ${e.message}`, "error");
    } finally {
      setL(false);
    }
  }, [apiKey, loading, addLog, startCooldown]);

  // store latest run in ref so intervals always call the current version
  useEffect(() => { runRef.current = run; }, [run]);

  // Auto-refresh: always on when apiKey present
  useEffect(() => {
    if (!apiKey) return;
    // immediate first scan
    runRef.current(true);
    // auto-refresh every INTERVAL seconds
    const autoInt = setInterval(() => runRef.current(true), INTERVAL * 1000);
    // live countdown
    const cdInt = setInterval(() => setCd(p => (p <= 1 ? INTERVAL : p - 1)), 1000);
    return () => { clearInterval(autoInt); clearInterval(cdInt); };
  }, [apiKey]); // only re-run if apiKey changes

  // Position calc
  const { riskUSD, qty, p1, p2 } = useMemo(() => {
    const rU = parseFloat(bal||0) * parseFloat(risk||0) / 100;
    const rPX = d ? Math.abs(d.price - d.stop_loss) : 0;
    const q   = rPX > 0 ? Math.floor(rU / rPX) : 0;
    return {
      riskUSD: rU, qty: q,
      p1: d?.tp1 ? (q*Math.abs(d.tp1-d.price)).toFixed(2) : "—",
      p2: d?.tp2 ? (q*Math.abs(d.tp2-d.price)).toFixed(2) : "—",
    };
  }, [bal, risk, d]);

  const dc  = d?.direction==="LONG" ? G.green : d?.direction==="SHORT" ? G.red : G.blue;
  const dcL = d?.direction==="LONG" ? G.greenL : d?.direction==="SHORT" ? G.redL : G.blueL;
  const dcB = d?.direction==="LONG" ? G.greenB : d?.direction==="SHORT" ? G.redB : G.blueB;

  const tabs = [["signal","⚡","Signal"],["chart","📊","Chart"],["info","🔬","Analysis"],["calc","🎯","Position"],["journal","📓","Journal"]];

  return (
    <div style={{ fontFamily:"'DM Sans',system-ui,sans-serif", background:G.bg, color:G.text,
      minHeight:"100vh", padding:"14px",
      backgroundImage:"radial-gradient(ellipse 80% 50% at 50% -10%, rgba(77,171,255,0.08), transparent)" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;900&display=swap" rel="stylesheet"/>
      <style>{`
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        input,button{font-family:'DM Sans',system-ui,sans-serif;outline:none}
        input:focus{border-color:${G.blue}!important;box-shadow:0 0 0 3px ${G.blueL}}
        button{transition:all 0.18s}
        button:active{transform:scale(0.95)!important}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.2)}}
        @keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes glow{0%,100%{opacity:.7}50%{opacity:1}}
        .fade{animation:up 0.25s ease}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
        input::placeholder{color:${G.muted}}
      `}</style>

      {/* ── Header ────────────────────────────────────────────── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ position:"relative" }}>
            <div style={{ fontFamily:"monospace", fontSize:26, fontWeight:900,
              background:`linear-gradient(135deg,${G.blue},${G.green})`,
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>XRP</div>
            {d && <div style={{ position:"absolute", top:-2, right:-10, width:7, height:7,
              borderRadius:"50%", background:G.green, animation:"pulse 2s infinite",
              boxShadow:`0 0 8px ${G.green}` }}/>}
          </div>
          <div style={{ background:`linear-gradient(135deg,${G.blueL},${G.greenL})`,
            border:`1px solid ${G.blueB}`, borderRadius:8, padding:"3px 10px",
            fontSize:10, fontWeight:800, color:G.blue, letterSpacing:1 }}>5M SCALPER</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <LiveClock/>
          {apiKey && (
            <CountdownRing secs={countdown} loading={loading}/>
          )}
          {apiKey && (
            <button
              onClick={() => { if(window.confirm("Remove API key?")) { setApiKey(""); LS.set("xrp_api_key",""); } }}
              title="Remove key"
              style={{ background:"rgba(255,255,255,0.05)", border:`1px solid ${G.border}`,
                borderRadius:10, padding:"5px 10px", cursor:"pointer", fontSize:13, color:G.muted }}>
              🔑
            </button>
          )}
        </div>
      </div>

      {/* ── API Gate ──────────────────────────────────────────── */}
      {!apiKey && <ApiKeyGate onSave={k => setApiKey(k)}/>}

      {/* ── Price Bar ─────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom:12, display:"flex", justifyContent:"space-between",
        alignItems:"center", background:`linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))` }}>
        <div>
          <div style={{ fontSize:10, color:G.muted, fontWeight:700, letterSpacing:2, marginBottom:4 }}>XRP / USD  LIVE</div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ fontFamily:"monospace", fontSize:34, fontWeight:900, lineHeight:1,
              color: d ? (d.change1h>=0?G.green:G.red) : G.text }}>
              {d ? `$${d.price?.toFixed(5)}` : <span style={{ color:G.muted, fontSize:24 }}>———</span>}
            </div>
            {d && <CopyBtn value={d.price?.toFixed(5)} id="price" copied={copied} onCopy={copy}/>}
          </div>
          {d && (
            <div style={{ display:"flex", gap:12, marginTop:6 }}>
              <span style={{ fontSize:12, fontWeight:800,
                color:d.change1h>=0?G.green:G.red,
                background:d.change1h>=0?G.greenL:G.redL,
                padding:"2px 8px", borderRadius:6 }}>
                {d.change1h>=0?"▲":"▼"} {Math.abs(d.change1h||0).toFixed(2)}% 1h
              </span>
              <span style={{ fontSize:11, color:G.muted }}>
                {d.change24h>=0?"▲":"▼"} {Math.abs(d.change24h||0).toFixed(2)}% 24h
              </span>
            </div>
          )}
          {lastUp && <div style={{ fontSize:10, color:G.muted, marginTop:4 }}>Last scan {lastUp.toLocaleTimeString()}</div>}
        </div>
        {d && (
          <div style={{ textAlign:"center" }}>
            <Ring v={d.confidence} color={d.confidence>=80?G.green:d.confidence>=65?G.amber:G.red} size={64}/>
            <div style={{ fontSize:9, color:G.muted, marginTop:3, fontWeight:700, letterSpacing:1 }}>CONFIDENCE</div>
          </div>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4, marginBottom:12,
        background:"rgba(255,255,255,0.03)", borderRadius:16, padding:5,
        border:`1px solid ${G.border}` }}>
        {tabs.map(([id, icon, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            background: tab===id ? "rgba(255,255,255,0.08)" : "transparent",
            border: tab===id ? `1px solid ${G.borderHi}` : "1px solid transparent",
            borderRadius:12, padding:"7px 2px",
            color: tab===id ? G.text : G.muted,
            fontSize:10, fontWeight:tab===id?800:500, cursor:"pointer",
            boxShadow: tab===id ? "0 2px 8px rgba(0,0,0,0.3)" : "none",
          }}>
            <div style={{ fontSize:16, marginBottom:2 }}>{icon}</div>
            <div style={{ letterSpacing:0.3 }}>{lbl}</div>
          </button>
        ))}
      </div>

      {/* ════════ SIGNAL TAB ════════════════════════════════════ */}
      {tab==="signal" && (
        <div className="fade">

          {/* Main signal card */}
          {d && d.tradeable ? (
            <div style={{ background:`linear-gradient(135deg,${dcL},rgba(255,255,255,0.02))`,
              border:`1px solid ${dcB}`, borderRadius:24, padding:"20px 18px",
              marginBottom:12, boxShadow:`0 0 40px ${dc}15` }}>

              {/* Direction */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:dc, letterSpacing:3, marginBottom:6 }}>SCALP SIGNAL</div>
                  <div style={{ fontFamily:"monospace", fontSize:52, fontWeight:900, color:dc, lineHeight:1,
                    textShadow:`0 0 30px ${dc}60` }}>
                    {d.direction==="LONG" ? "▲ LONG" : "▼ SHORT"}
                  </div>
                  <div style={{ fontSize:13, color:G.mid, marginTop:10, lineHeight:1.6, fontWeight:600,
                    maxWidth:260 }}>{d.why}</div>
                </div>
                <div style={{ textAlign:"center", background:"rgba(0,0,0,0.2)", borderRadius:16,
                  padding:"10px 14px", border:`1px solid ${G.border}` }}>
                  <div style={{ fontSize:9, color:G.muted, letterSpacing:2, fontWeight:700 }}>HOLD</div>
                  <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:900, color:dc, marginTop:4 }}>{d.hold}</div>
                </div>
              </div>

              {/* Trigger */}
              <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:14, padding:"12px 16px",
                marginBottom:14, border:`1px solid ${dcB}30` }}>
                <div style={{ fontSize:9, fontWeight:800, color:G.muted, letterSpacing:2, marginBottom:5 }}>ENTRY TRIGGER</div>
                <div style={{ fontSize:13, fontWeight:700, color:G.text, lineHeight:1.5 }}>⚡ {d.trigger}</div>
              </div>

              {/* Entry big */}
              <div style={{ background:"rgba(0,0,0,0.3)", borderRadius:18, padding:"16px 18px",
                marginBottom:12, textAlign:"center", border:`1px solid ${dc}30` }}>
                <div style={{ fontSize:10, fontWeight:800, color:dc, letterSpacing:3, marginBottom:6 }}>ENTER AT</div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <div style={{ fontFamily:"monospace", fontSize:42, fontWeight:900, color:dc, lineHeight:1,
                    textShadow:`0 0 20px ${dc}80` }}>
                    ${d.entry?.toFixed(5)}
                  </div>
                  <CopyBtn value={d.entry?.toFixed(5)} id="entry" copied={copied} onCopy={copy}/>
                </div>
                <div style={{ fontSize:11, color:G.muted, marginTop:6 }}>
                  {d.direction==="LONG"
                    ? `${((d.entry-d.price)/d.price*100).toFixed(3)}% from current`
                    : `${((d.price-d.entry)/d.price*100).toFixed(3)}% from current`}
                </div>
              </div>

              {/* SL / TP1 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div style={{ background:`linear-gradient(135deg,${G.redL},rgba(0,0,0,0.1))`,
                  border:`1px solid ${G.redB}`, borderRadius:16, padding:"14px 16px" }}>
                  <div style={{ fontSize:9, fontWeight:800, color:G.red, letterSpacing:2, marginBottom:6 }}>🔴 STOP LOSS</div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ fontFamily:"monospace", fontSize:18, fontWeight:900, color:G.red }}>${d.stop_loss?.toFixed(5)}</div>
                    <CopyBtn value={d.stop_loss?.toFixed(5)} id="sl" copied={copied} onCopy={copy}/>
                  </div>
                  <div style={{ fontSize:11, color:G.red, fontWeight:700, marginTop:4 }}>-{d.stop_pct?.toFixed(2)}%</div>
                </div>
                <div style={{ background:`linear-gradient(135deg,${G.greenL},rgba(0,0,0,0.1))`,
                  border:`1px solid ${G.greenB}`, borderRadius:16, padding:"14px 16px" }}>
                  <div style={{ fontSize:9, fontWeight:800, color:G.green, letterSpacing:2, marginBottom:6 }}>🟢 TARGET 1</div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ fontFamily:"monospace", fontSize:18, fontWeight:900, color:G.green }}>${d.tp1?.toFixed(5)}</div>
                    <CopyBtn value={d.tp1?.toFixed(5)} id="tp1" copied={copied} onCopy={copy}/>
                  </div>
                  <div style={{ fontSize:11, color:G.green, fontWeight:700, marginTop:4 }}>+{d.tp1_pct?.toFixed(2)}%</div>
                </div>
              </div>

              {/* TP2 */}
              <div style={{ background:`linear-gradient(135deg,${G.greenL},rgba(0,0,0,0.15))`,
                border:`1px solid ${G.greenB}`, borderRadius:16, padding:"14px 16px",
                display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:9, fontWeight:800, color:G.green, letterSpacing:2, marginBottom:6 }}>🟢 TARGET 2 · LET IT RUN</div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:900, color:G.green }}>${d.tp2?.toFixed(5)}</div>
                    <CopyBtn value={d.tp2?.toFixed(5)} id="tp2" copied={copied} onCopy={copy}/>
                  </div>
                  <div style={{ fontSize:11, color:G.green, fontWeight:700, marginTop:4 }}>+{d.tp2_pct?.toFixed(2)}%</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:10, color:G.muted, marginBottom:4 }}>R:R RATIO</div>
                  <div style={{ fontFamily:"monospace", fontSize:24, fontWeight:900,
                    color:d.rr>=2?G.green:G.amber,
                    textShadow:d.rr>=2?`0 0 16px ${G.green}80`:"none" }}>1:{d.rr}</div>
                </div>
              </div>
            </div>

          ) : d && !d.tradeable ? (
            <div style={{ ...card, background:`linear-gradient(135deg,${G.amberL},rgba(0,0,0,0.1))`,
              border:`1px solid ${G.amberB}`, textAlign:"center", padding:36 }}>
              <div style={{ fontSize:44, marginBottom:10, animation:"glow 2s infinite" }}>⏸</div>
              <div style={{ fontSize:26, fontWeight:900, color:G.amber }}>WAIT</div>
              <div style={{ fontSize:13, color:G.mid, marginTop:10, lineHeight:1.6 }}>{d.skip_reason}</div>
            </div>
          ) : (
            <div style={{ ...card, textAlign:"center", padding:48 }}>
              {loading ? (
                <>
                  <div style={{ fontSize:40, animation:"spin 1.2s linear infinite", display:"inline-block", marginBottom:12 }}>⚡</div>
                  <div style={{ fontSize:16, fontWeight:700, color:G.blue }}>Scanning XRP markets…</div>
                  <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>Searching live data via AI</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize:44, marginBottom:12 }}>⚡</div>
                  <div style={{ fontSize:18, fontWeight:800, color:G.mid }}>Enter API key to start</div>
                  <div style={{ fontSize:12, color:G.muted, marginTop:6 }}>Auto-scans every 60 seconds</div>
                </>
              )}
            </div>
          )}

          {/* Market pulse */}
          {d && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:10 }}>
              <StatChip label="MOMENTUM" value={`${d.momentum}%`} color={d.momentum>=65?G.green:d.momentum<=35?G.red:G.amber}/>
              <StatChip label="VOLUME"   value={d.volume}          color={d.volume==="HIGH"?G.green:d.volume==="LOW"?G.red:G.amber}/>
              <StatChip label="SESSION"  value={`${d.session}/10`} color={d.session>=7?G.green:d.session>=5?G.amber:G.red}/>
              <StatChip label="BTC"      value={d.btc}             color={d.btc==="UP"?G.green:d.btc==="DOWN"?G.red:G.muted}/>
            </div>
          )}

          {/* Order book */}
          {d && (
            <div style={card}>
              <span style={label}>ORDER BOOK PRESSURE</span>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:800, marginBottom:8 }}>
                <span style={{ color:G.green }}>BUYERS {d.buyers_pct}%</span>
                <span style={{ color:G.red }}>SELLERS {100-d.buyers_pct}%</span>
              </div>
              <div style={{ height:12, borderRadius:6, overflow:"hidden", display:"flex",
                boxShadow:`0 0 0 1px ${G.border}` }}>
                <div style={{ width:`${d.buyers_pct}%`, background:`linear-gradient(90deg,${G.green}99,${G.green})`,
                  transition:"width 1s ease", boxShadow:`4px 0 12px ${G.green}40` }}/>
                <div style={{ flex:1, background:`linear-gradient(90deg,${G.red},${G.red}99)` }}/>
              </div>
              <div style={{ fontSize:12, color:G.mid, marginTop:8, fontWeight:600 }}>
                {d.buyers_pct>=55 ? "💪 Buyers dominate — favors LONG"
                  : d.buyers_pct<=45 ? "⚡ Sellers dominate — favors SHORT"
                  : "⚖️ Balanced — wait for momentum"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════ CHART TAB ═════════════════════════════════════ */}
      {tab==="chart" && (
        <div className="fade">
          <div style={card}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <span style={label}>5M CHART · LAST 2H</span>
              {d && <span style={{ fontSize:12, fontWeight:800,
                color:d.trend_5m==="UP"?G.green:d.trend_5m==="DOWN"?G.red:G.amber }}>
                {d.trend_5m==="UP"?"▲ UPTREND":d.trend_5m==="DOWN"?"▼ DOWNTREND":"↔ CHOPPY"}
              </span>}
            </div>
            <Chart data={d?.history} entry={d?.entry} sl={d?.stop_loss} tp1={d?.tp1} tp2={d?.tp2} dir={d?.direction}/>
          </div>
          {d && (
            <div style={card}>
              <span style={label}>KEY LEVELS</span>
              {[
                ["ENTER",                                              d.entry,       G.blue,    "lvl-entry"],
                [d.direction==="LONG"?"▼ STOP LOSS":"▲ STOP LOSS",   d.stop_loss,   G.red,     "lvl-sl"],
                ["▲ TARGET 1",                                         d.tp1,         G.green,   "lvl-tp1"],
                ["▲ TARGET 2",                                         d.tp2,         "#00CC80", "lvl-tp2"],
                ["SUPPORT",                                            d.support,     G.muted,   "lvl-sup"],
                ["RESISTANCE",                                         d.resistance,  G.muted,   "lvl-res"],
              ].map(([l, v, c, cid]) => (
                <PriceRow key={l} lbl={l} value={v} color={c} cid={cid} copied={copied} onCopy={copy}/>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════ ANALYSIS TAB ══════════════════════════════════ */}
      {tab==="info" && (
        <div className="fade">
          {d ? (
            <>
              <div style={card}>
                <span style={label}>TECHNICAL INDICATORS</span>
                <RSIBar v={d.rsi}/>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:16 }}>
                  {[
                    ["MACD",     d.macd,                        d.macd==="BULLISH"?G.green:d.macd==="BEARISH"?G.red:G.amber],
                    ["TREND 1H", d.trend_1h,                    d.trend_1h==="UP"?G.green:d.trend_1h==="DOWN"?G.red:G.amber],
                    ["EMA 9",    `$${d.ema9?.toFixed(4)}`,      G.blue],
                    ["VWAP",     `$${d.vwap?.toFixed(4)}`,      G.mid],
                    ["SUPPORT",  `$${d.support?.toFixed(4)}`,   G.green],
                    ["RESIST",   `$${d.resistance?.toFixed(4)}`, G.red],
                  ].map(([l, v, c]) => (
                    <div key={l} style={{ background:"rgba(255,255,255,0.04)", borderRadius:14,
                      padding:"12px 14px", border:`1px solid ${G.border}` }}>
                      <div style={{ fontSize:9, color:G.muted, fontWeight:700, letterSpacing:1.5, marginBottom:4 }}>{l}</div>
                      <div style={{ fontSize:15, fontWeight:900, color:c, fontFamily:"monospace" }}>{v||"—"}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={card}>
                <span style={label}>SIGNAL STRENGTH</span>
                <div style={{ display:"flex", alignItems:"center", gap:18 }}>
                  <Ring v={d.confidence} color={d.confidence>=80?G.green:d.confidence>=65?G.amber:G.red} size={72}/>
                  <div>
                    <div style={{ fontSize:20, fontWeight:900,
                      color:d.strength==="STRONG"?G.green:d.strength==="MEDIUM"?G.amber:G.red }}>
                      {d.strength} SETUP
                    </div>
                    <div style={{ fontSize:12, color:G.mid, marginTop:6, lineHeight:1.6 }}>
                      {d.confidence>=80 ? "High-probability — enter with full size"
                        : d.confidence>=65 ? "Decent setup — standard size"
                        : "Weak — reduce size or skip"}
                    </div>
                  </div>
                </div>
              </div>

              <div style={card}>
                <span style={label}>SESSION QUALITY</span>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <span style={{ fontSize:16, fontWeight:800,
                    color:d.session>=7?G.green:d.session>=5?G.amber:G.red }}>
                    {d.session>=8?"🔥 PRIME TIME":d.session>=6?"✅ ACTIVE":d.session>=4?"⚠️ SLOW":"🚫 DEAD"}
                  </span>
                  <span style={{ fontFamily:"monospace", fontSize:24, fontWeight:900,
                    color:d.session>=7?G.green:d.session>=5?G.amber:G.red }}>{d.session}/10</span>
                </div>
                <div style={{ height:8, background:"rgba(255,255,255,0.06)", borderRadius:4, overflow:"hidden" }}>
                  <div style={{ width:`${d.session*10}%`, height:"100%", borderRadius:4, transition:"width 1s",
                    background:d.session>=7?`linear-gradient(90deg,${G.green}80,${G.green})`
                      :d.session>=5?`linear-gradient(90deg,${G.amber}80,${G.amber})`
                      :`linear-gradient(90deg,${G.red}80,${G.red})`,
                    boxShadow:`4px 0 12px ${d.session>=7?G.green:d.session>=5?G.amber:G.red}60` }}/>
                </div>
              </div>
            </>
          ) : <div style={{ textAlign:"center", padding:48, color:G.muted, fontSize:14 }}>Waiting for first scan…</div>}
        </div>
      )}

      {/* ════════ POSITION TAB ══════════════════════════════════ */}
      {tab==="calc" && (
        <div className="fade">
          <div style={card}>
            <span style={label}>POSITION SIZE CALCULATOR</span>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
              {[["Portfolio ($)", bal, setBal], ["Risk %", risk, setRisk]].map(([l,v,fn]) => (
                <div key={l}>
                  <div style={{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:6 }}>{l}</div>
                  <input value={v} onChange={e=>fn(e.target.value)} type="number"
                    style={{ width:"100%", background:"rgba(255,255,255,0.05)",
                      border:`1px solid ${G.border}`, borderRadius:12, padding:"11px 14px",
                      fontSize:18, fontFamily:"monospace", fontWeight:700, color:G.text }}/>
                </div>
              ))}
            </div>
            {d ? (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[
                  ["$ at Risk",     `$${riskUSD.toFixed(0)}`,        G.red],
                  ["XRP to Buy",    qty.toLocaleString(),             G.blue],
                  ["Profit @ TP1",  `+$${p1}`,                        G.green],
                  ["Profit @ TP2",  `+$${p2}`,                        G.green],
                  ["Position $",    `$${(qty*d.price).toFixed(0)}`,   G.text],
                  ["R : R",         `1 : ${d.rr}`,                    d.rr>=2?G.green:G.amber],
                ].map(([l,v,c]) => (
                  <div key={l} style={{ background:"rgba(255,255,255,0.04)", borderRadius:14,
                    padding:"12px 14px", border:`1px solid ${G.border}` }}>
                    <div style={{ fontSize:10, color:G.muted, fontWeight:700, marginBottom:4 }}>{l}</div>
                    <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:900, color:c }}>{v}</div>
                  </div>
                ))}
              </div>
            ) : <div style={{ textAlign:"center", color:G.muted, padding:20, fontSize:13 }}>Waiting for scan…</div>}
          </div>

          <div style={card}>
            <span style={label}>SCALPER'S RULES</span>
            {[
              [G.red,   "ALWAYS set SL before entering. No SL = gambling."],
              [G.green, "TP1 first (50%). Lock profit. Let TP2 run."],
              [G.blue,  "Only enter on the TRIGGER — not before."],
              [G.amber, "Strong setup = full size. Weak = half or skip."],
              [G.red,   "CHOPPY market = sit on hands. Wait."],
              [G.green, "5X leverage: 1% move = 5% gain. Respect it."],
              [G.muted, "Session < 5? Don't trade. Come back later."],
              [G.blue,  "BTC opposite? Reduce position size 50%."],
            ].map(([c,t],i) => (
              <div key={i} style={{ display:"flex", gap:12, padding:"10px 0",
                borderBottom:`1px solid ${G.border}` }}>
                <div style={{ width:28, height:28, borderRadius:"50%",
                  background:`${c}12`, border:`1.5px solid ${c}30`,
                  color:c, fontSize:12, fontWeight:900, display:"flex",
                  alignItems:"center", justifyContent:"center", flexShrink:0,
                  boxShadow:`0 0 8px ${c}20` }}>{i+1}</div>
                <div style={{ fontSize:12, color:G.mid, lineHeight:1.6, fontWeight:500, paddingTop:4 }}>{t}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════ JOURNAL TAB ═══════════════════════════════════ */}
      {tab==="journal" && (
        <div className="fade">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <span style={label}>SIGNAL HISTORY ({journal.length})</span>
            {journal.length>0 && (
              <button onClick={() => { if(window.confirm("Clear all?")){ setJournal([]); LS.set("xrp_journal",[]); } }}
                style={{ background:"none", border:`1px solid ${G.redB}`, borderRadius:8,
                  padding:"4px 12px", color:G.red, fontSize:11, fontWeight:700, cursor:"pointer" }}>Clear</button>
            )}
          </div>
          {journal.length===0 ? (
            <div style={{ textAlign:"center", padding:48, color:G.muted }}>
              <div style={{ fontSize:36, marginBottom:12 }}>📓</div>
              <div style={{ fontSize:14 }}>No signals recorded yet</div>
              <div style={{ fontSize:11, marginTop:6 }}>Tradeable signals will appear here</div>
            </div>
          ) : journal.map(j => (
            <div key={j.id} style={{ ...card, padding:"14px 16px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  <span style={{ fontFamily:"monospace", fontSize:16, fontWeight:900,
                    color:j.dir==="LONG"?G.green:G.red,
                    textShadow:`0 0 12px ${j.dir==="LONG"?G.green:G.red}60` }}>
                    {j.dir==="LONG"?"▲":"▼"} {j.dir}
                  </span>
                  <span style={{ fontSize:10, fontWeight:800, borderRadius:6, padding:"2px 8px",
                    background:j.confidence>=80?G.greenL:j.confidence>=65?G.amberL:G.redL,
                    color:j.confidence>=80?G.green:j.confidence>=65?G.amber:G.red,
                    border:`1px solid ${j.confidence>=80?G.greenB:j.confidence>=65?G.amberB:G.redB}` }}>
                    {j.confidence}%
                  </span>
                  <span style={{ fontSize:10, color:G.muted, background:"rgba(255,255,255,0.05)",
                    padding:"2px 8px", borderRadius:6 }}>1:{j.rr}</span>
                </div>
                <span style={{ fontSize:10, color:G.muted }}>{new Date(j.ts).toLocaleString()}</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
                {[["ENTRY",j.entry,G.blue],["SL",j.sl,G.red],["TP1",j.tp1,G.green]].map(([l,v,c]) => (
                  <div key={l} style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"8px 10px" }}>
                    <div style={{ fontSize:9, color:G.muted, fontWeight:700, marginBottom:3 }}>{l}</div>
                    <div style={{ fontFamily:"monospace", fontSize:12, fontWeight:900, color:c }}>${v?.toFixed(4)}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:10, color:G.muted, marginTop:8 }}>
                Spot: ${j.price?.toFixed(5)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warning */}
      {d?.warning && (
        <div style={{ background:G.amberL, border:`1px solid ${G.amberB}`, borderRadius:14,
          padding:"10px 16px", marginTop:6, fontSize:12, color:G.amber, fontWeight:700 }}>
          ⚠️ {d.warning}
        </div>
      )}

      {/* ── Manual Refresh Button ─────────────────────────────── */}
      <div style={{ marginTop:14 }}>
        <button
          onClick={() => run(false)}
          disabled={loading || cooldown>0 || !apiKey}
          style={{
            width:"100%",
            padding:"16px 0",
            borderRadius:16,
            border:"none",
            fontFamily:"DM Sans",
            fontWeight:900,
            fontSize:16,
            cursor: loading||cooldown>0||!apiKey ? "default" : "pointer",
            background: loading||cooldown>0||!apiKey
              ? "rgba(255,255,255,0.05)"
              : `linear-gradient(135deg,${G.blue},#0066DD)`,
            color: loading||cooldown>0||!apiKey ? G.muted : "#fff",
            boxShadow: loading||cooldown>0||!apiKey ? "none" : `0 4px 24px ${G.blue}40`,
            transition:"all 0.2s",
            letterSpacing:0.5,
          }}>
          {loading ? "⏳ Scanning live markets…"
            : cooldown>0 ? `⏱ Next manual refresh in ${cooldown}s`
            : !apiKey ? "Enter API key above to start"
            : "⚡ Refresh Now"}
        </button>
        {apiKey && (
          <div style={{ textAlign:"center", fontSize:10, color:G.muted, marginTop:8 }}>
            🔄 Auto-refreshing every {INTERVAL}s · Next in <span style={{ color:G.blue, fontWeight:700 }}>{countdown}s</span>
          </div>
        )}
      </div>

      {/* Log */}
      <div style={{ ...card, marginTop:10, maxHeight:90, overflowY:"auto", padding:"10px 14px" }}>
        {log.length===0
          ? <div style={{ fontSize:12, color:G.muted }}>Activity log will appear here…</div>
          : log.map((l,i) => (
            <div key={i} style={{ fontSize:11, marginBottom:3,
              color:l.type==="success"?G.green:l.type==="error"?G.red:G.muted }}>
              <span style={{ color:"rgba(255,255,255,0.15)" }}>[{l.t}]</span> {l.msg}
            </div>
          ))}
      </div>

      {error && (
        <div style={{ background:G.redL, border:`1px solid ${G.redB}`, borderRadius:14,
          padding:"12px 16px", marginTop:8, fontSize:12, color:G.red, fontWeight:700 }}>
          ❌ {error}
          {(error.includes("key")||error.includes("401")||error.includes("403")) && (
            <span style={{ marginLeft:8, textDecoration:"underline", cursor:"pointer", opacity:0.8 }}
              onClick={() => { setApiKey(""); LS.set("xrp_api_key",""); }}> Re-enter key</span>
          )}
        </div>
      )}

      <div style={{ fontSize:9, color:G.muted, textAlign:"center", marginTop:14, lineHeight:2 }}>
        Educational tool only · Always use stop losses · Trade responsibly<br/>
        <span style={{ color:"rgba(255,255,255,0.08)" }}>Not financial advice · Past signals ≠ future results</span>
      </div>
    </div>
  );
}
