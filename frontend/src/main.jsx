import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from "recharts";
import "./style.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const algorithms = ["token_bucket", "sliding_window"];

function Countdown({ event, label, now }) {
  if (!event || event.allowed) return null;
  const unlockAt =
    new Date(event.timestamp).getTime() + event.retry_after * 1000;
  const seconds = Math.max(0, (unlockAt - now) / 1000);
  if (seconds === 0) return null;
  return (
    <div className="countdown" aria-live="polite">
      <span>{label}</span>
      <strong>{seconds.toFixed(1)}s</strong>
    </div>
  );
}

function AlgorithmCard({ algorithm, events, now }) {
  const recent = events.filter((e) => e.algorithm === algorithm).slice(-20);
  const last = recent.at(-1);
  if (algorithm === "token_bucket") {
    const state = last?.algorithm_state || {};
    const capacity = state.capacity ?? 12;
    const refillRate = state.refill_rate ?? 2;
    const samples = recent.length
      ? recent.map((event) => Math.max(0, Math.min(capacity, event.algorithm_state?.tokens ?? capacity)))
      : [capacity];
    const points = samples.map((tokens, index) => {
      const x = samples.length === 1 ? 0 : (index / (samples.length - 1)) * 300;
      const y = 90 - (tokens / capacity) * 70;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const area = `M0,100 L${points.replace(/ /g, " L")} L300,100 Z`;
    const blocked = recent.filter((event) => !event.allowed).length;
    const dropRate = recent.length ? (blocked / recent.length) * 100 : 0;
    return (
      <section className="group relative flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-6 transition-colors hover:border-primary-container">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded border border-outline-variant bg-surface-container px-2 py-0.5 font-code-sm text-code-sm text-on-surface">TOKEN_BUCKET</span>
              <span className="flex h-4 w-8 justify-end rounded-full bg-primary-container/20 p-0.5"><i className="h-3 w-3 rounded-full bg-primary-container" /></span>
            </div>
            <h3 className="font-headline-lg text-[24px] text-on-surface">Token bucket</h3>
          </div>
          <span className="font-label-technical text-[20px] text-primary-container" aria-hidden="true">◉</span>
        </div>
        <p className="mb-6 flex-grow font-body-md text-sm text-on-surface-variant">Allows bursts up to its capacity. Each allowed request spends a token; Redis restores tokens at a fixed rate.</p>
        <div className="relative mb-4 h-32 rounded border border-outline-variant bg-surface p-2 [background-image:radial-gradient(#c3c6d7_1px,transparent_1px)] [background-size:8px_8px]">
          <span className="absolute left-2 top-1 font-label-technical text-[10px] text-on-surface-variant">Tokens available</span>
          <svg className="h-full w-full" viewBox="0 0 300 100" preserveAspectRatio="none" aria-label="Token level over recent requests">
            <line x1="0" x2="300" y1="20" y2="20" stroke="#737686" strokeDasharray="2" />
            <path d={area} fill="#dbe1ff" />
            <polyline points={points} fill="none" stroke="#004ac6" strokeWidth="2" />
            {recent.map((event, index) => !event.allowed && (
              <circle key={index} cx={samples.length === 1 ? 0 : (index / (samples.length - 1)) * 300} cy={20} fill="#ba1a1a" r="3" />
            ))}
          </svg>
        </div>
        <Countdown event={last} label="Next token available in" now={now} />
        <div className="grid grid-cols-3 gap-4 border-t border-outline-variant pt-4">
          <div><div className="font-label-technical text-label-technical text-on-surface-variant">Requests</div><div className="font-headline-lg text-[24px] text-on-surface">{recent.length}</div></div>
          <div><div className="font-label-technical text-label-technical text-on-surface-variant">Drop rate</div><div className="font-headline-lg text-[24px] text-error">{dropRate.toFixed(1)}<span className="font-code-sm text-sm text-on-surface-variant">%</span></div></div>
          <div><div className="font-label-technical text-label-technical text-on-surface-variant">Refill rate</div><div className="font-headline-lg text-[24px] text-on-surface">{refillRate}<span className="font-code-sm text-sm text-on-surface-variant">/s</span></div></div>
        </div>
      </section>
    );
  }
  const state = last?.algorithm_state || {};
  const count = state.count ?? 0,
    limit = state.limit ?? 10;
  return (
    <section className="card">
      <h3>Sliding window</h3>
      <div className="count">
        {count} <small>/ {limit} requests in trailing window</small>
      </div>
      <div className="dots">
        {recent.map((x, i) => (
          <i
            key={i}
            className={x.allowed ? "yes" : "no"}
            title={x.allowed ? "allowed" : "blocked"}
          />
        ))}
      </div>
      <p>The window moves continuously; the cap stays strict.</p>
      <Countdown event={last} label="Window unlocks in" now={now} />
      <ResponsiveContainer width="100%" height={105}>
        <BarChart
          data={recent.map((x, i) => ({ i, allowed: x.allowed ? 1 : 0 }))}
        >
          <XAxis dataKey="i" hide />
          <YAxis domain={[0, 1]} hide />
          <Bar dataKey="allowed" fill="#ab87ff" />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

function App() {
  const [events, setEvents] = useState([]),
    [mode, setMode] = useState("both"),
    [preset, setPreset] = useState("burst"),
    [rps, setRps] = useState(2),
    [burstSize, setBurstSize] = useState(10),
    [now, setNow] = useState(Date.now());
  const timers = useRef([]);
  const login = preset === "login";
  useEffect(() => {
    const source = new EventSource(`${API}/demo/stream`);
    source.onmessage = (e) =>
      setEvents((x) => [...x, JSON.parse(e.data)].slice(-100));
    return () => source.close();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const fire = (algorithm) =>
    fetch(`${API}/demo/${login ? "login" : "traffic"}?algorithm=${algorithm}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: login
        ? JSON.stringify({ username: "target@example.com", password: "wrong" })
        : undefined,
    });
  const run = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const targets = mode === "both" ? algorithms : [mode];
    const send = () => targets.forEach(fire);
    const interval = 1000 / rps;
    const scheduleSteady = (start = 0, durationSeconds = 6) => {
      for (let i = 0; i < rps * durationSeconds; i++)
        timers.current.push(setTimeout(send, start + i * interval));
    };
    if (preset === "steady") {
      scheduleSteady();
    } else {
      for (let i = 0; i < burstSize; i++) send();
      if (preset === "trickle" || preset === "login") scheduleSteady(1000);
    }
  };
  const resetDemo = async () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    await fetch(`${API}/demo/reset`, { method: "POST" });
    setEvents([]);
  };
  return (
    <main>
      <header>
        <h1>Rate limiter algorithms</h1>
        <p>Watch the same traffic behave differently under two algorithms.</p>
      </header>
      <div className="layout">
        <section className="controls">
          <h2>Traffic simulator</h2>
          <div className="primary-actions">
            <button className="start" onClick={run}>
              Start simulation
            </button>
            <button
              className="secondary"
              onClick={() =>
                (mode === "both" ? algorithms : [mode]).forEach(fire)
              }
            >
              Fire one
            </button>
          </div>
          <div className="control-divider" />
          <h3 className="parameters-title">Simulation parameters</h3>
          <label>
            Scenario preset
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="steady">Steady traffic</option>
              <option value="burst">Burst then idle</option>
              <option value="trickle">Burst then trickle</option>
              <option value="login">Login brute-force</option>
            </select>
          </label>
          <button className="reset" onClick={resetDemo}>
            Reset
          </button>
          <label>
            Request rate <output>{rps} RPS</output>
            <input
              type="range"
              min="1"
              max="10"
              value={rps}
              onChange={(e) => setRps(Number(e.target.value))}
            />
          </label>
          <label>
            Burst size <output>{burstSize} requests</output>
            <input
              type="range"
              min="1"
              max="20"
              value={burstSize}
              onChange={(e) => setBurstSize(Number(e.target.value))}
            />
          </label>
          <label>
            Run against
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="both">Side-by-side</option>
              <option value="token_bucket">Token bucket</option>
              <option value="sliding_window">Sliding window</option>
            </select>
          </label>
          <details>
            <summary>Why this design?</summary>
            <p>
              {login
                ? "RFC §5.1: login is security-sensitive; burst tolerance can enable probing, so sliding windows are selected."
                : "RFC §5.1: general API traffic is naturally bursty, so token buckets smooth traffic without punishing legitimate page loads."}
            </p>
            <a href="https://github.com/" onClick={(e) => e.preventDefault()}>
              See the included RFC →
            </a>
          </details>
        </section>
        <section className="visuals">
          {(mode === "both" || mode === "token_bucket") && (
            <AlgorithmCard algorithm="token_bucket" events={events} now={now} />
          )}{" "}
          {(mode === "both" || mode === "sliding_window") && (
            <AlgorithmCard
              algorithm="sliding_window"
              events={events}
              now={now}
            />
          )}
          <section className="log">
            <h2>Live request log</h2>
            {events
              .slice()
              .reverse()
              .map((e, i) => (
                <div key={i}>
                  <time>{new Date(e.timestamp).toLocaleTimeString()}</time>
                  <b>{e.algorithm.replace("_", " ")}</b>
                  <span className={e.allowed ? "allowed" : "blocked"}>
                    {e.allowed ? "allowed" : "blocked"}
                  </span>
                  {!e.allowed && ` retry ${Math.ceil(e.retry_after)}s`}
                </div>
              ))}
          </section>
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
