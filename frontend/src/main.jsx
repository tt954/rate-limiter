import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const algorithms = ["token_bucket", "sliding_window"];

function HeaderCountdown({ event, label, now }) {
  const unlockAt = event
    ? new Date(event.timestamp).getTime() + event.retry_after * 1000
    : 0;
  const seconds = Math.max(0, (unlockAt - now) / 1000);
  const active = event && !event.allowed && seconds > 0;
  return (
    <div className={`min-w-[112px] text-right font-label-technical text-label-technical ${active ? "text-secondary" : "invisible"}`} aria-live="polite">
      <div>{label}</div>
      <strong className="font-code-sm text-[20px]">{active ? `${seconds.toFixed(1)}s` : "0.0s"}</strong>
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
            </div>
            <h3 className="font-headline-lg text-[24px] text-on-surface">Token bucket</h3>
          </div>
          <HeaderCountdown event={last} label="Next token in" now={now} />
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
  const samples = recent.length
    ? recent.map((event) => Math.max(0, Math.min(limit, event.algorithm_state?.count ?? 0)))
    : [0];
  const points = samples.map((requestCount, index) => {
    const x = samples.length === 1 ? 0 : (index / (samples.length - 1)) * 300;
    const y = 90 - (requestCount / limit) * 70;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `M0,100 L${points.replace(/ /g, " L")} L300,100 Z`;
  const blocked = recent.filter((event) => !event.allowed).length;
  const blockRate = recent.length ? (blocked / recent.length) * 100 : 0;
  return (
    <section className="group relative flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-6 transition-colors hover:border-secondary-container">
      <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded border border-outline-variant bg-surface-container px-2 py-0.5 font-code-sm text-code-sm text-on-surface">SLIDING_WINDOW</span>
            </div>
            <h3 className="font-headline-lg text-[24px] text-on-surface">Sliding window</h3>
          </div>
          <HeaderCountdown event={last} label="Window unlocks in" now={now} />
      </div>
      <p className="mb-6 flex-grow font-body-md text-sm text-on-surface-variant">Counts every request within a moving time window, enforcing a strict cap without burst tolerance.</p>
      <div className="relative mb-4 h-32 rounded border border-outline-variant bg-surface p-2 [background-image:radial-gradient(#c3c6d7_1px,transparent_1px)] [background-size:8px_8px]">
        <span className="absolute left-2 top-1 font-label-technical text-[10px] text-on-surface-variant">Requests in trailing window</span>
        <svg className="h-full w-full" viewBox="0 0 300 100" preserveAspectRatio="none" aria-label="Sliding window request count over recent requests">
          <line x1="0" x2="300" y1="20" y2="20" stroke="#737686" strokeDasharray="2" />
          <path d={area} fill="#dde1ff" />
          <polyline points={points} fill="none" stroke="#3755c3" strokeWidth="2" />
          {recent.map((event, index) => !event.allowed && (
            <circle key={index} cx={samples.length === 1 ? 0 : (index / (samples.length - 1)) * 300} cy={20} fill="#ba1a1a" r="3" />
          ))}
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-4 border-t border-outline-variant pt-4">
        <div><div className="font-label-technical text-label-technical text-on-surface-variant">Requests</div><div className="font-headline-lg text-[24px] text-on-surface">{recent.length}</div></div>
        <div><div className="font-label-technical text-label-technical text-on-surface-variant">Block rate</div><div className="font-headline-lg text-[24px] text-error">{blockRate.toFixed(1)}<span className="font-code-sm text-sm text-on-surface-variant">%</span></div></div>
        <div><div className="font-label-technical text-label-technical text-on-surface-variant">Hard cap</div><div className="font-headline-lg text-[24px] text-on-surface">{count}<span className="font-code-sm text-sm text-on-surface-variant">/{limit}</span></div></div>
      </div>
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
          <div className="mb-8 px-2">
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-outline-variant bg-primary-fixed font-code-sm text-code-sm font-bold text-primary" aria-hidden="true">RL</div>
              <div>
                <h2 className="font-headline-lg text-[18px] font-bold text-primary-container">Simulation control</h2>
                <p className="font-label-technical text-label-technical text-on-surface-variant">v1.0.0</p>
              </div>
            </div>
            <button className="mt-4 w-full rounded-lg bg-primary-container py-2 font-code-sm text-code-sm font-bold text-on-primary transition-colors duration-150 hover:bg-primary active:scale-95" onClick={run}>Start simulation</button>
            <button className="mt-2 w-full rounded-lg border border-outline-variant bg-transparent py-2 font-code-sm text-code-sm text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-highest" onClick={() =>
              (mode === "both" ? algorithms : [mode]).forEach(fire)
            }>Fire one</button>
          </div>
          <div className="mb-4 mt-4 border-t border-outline-variant pt-4">
            <h3 className="mb-3 px-2 font-code-sm text-code-sm text-on-surface">Simulation parameters</h3>
            <div className="space-y-4 px-2">
              <div>
                <label className="mb-1 flex justify-between font-label-technical text-label-technical text-on-surface-variant">
                  <span>Request rate (RPS)</span><span className="font-code-sm text-primary-container">{rps}</span>
                </label>
                <input type="range" min="1" max="10" value={rps} onChange={(e) => setRps(Number(e.target.value))} />
              </div>
              <div>
                <label className="mb-1 flex justify-between font-label-technical text-label-technical text-on-surface-variant">
                  <span>Burst size</span><span className="font-code-sm text-primary-container">{burstSize}</span>
                </label>
                <input type="range" min="1" max="20" value={burstSize} onChange={(e) => setBurstSize(Number(e.target.value))} />
              </div>
              <div>
                <label className="mb-1 block font-label-technical text-label-technical text-on-surface-variant">Scenario preset</label>
                <select className="w-full rounded border border-outline-variant bg-surface p-1.5 font-code-sm text-code-sm text-on-surface focus:border-primary-container focus:outline-none" value={preset} onChange={(e) => setPreset(e.target.value)}>
                  <option value="steady">Steady traffic</option>
                  <option value="burst">Burst then idle</option>
                  <option value="trickle">Burst then trickle</option>
                  <option value="login">Login brute-force</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-label-technical text-label-technical text-on-surface-variant">Run against</label>
                <select className="w-full rounded border border-outline-variant bg-surface p-1.5 font-code-sm text-code-sm text-on-surface focus:border-primary-container focus:outline-none" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="both">Side-by-side</option>
                  <option value="token_bucket">Token bucket</option>
                  <option value="sliding_window">Sliding window</option>
                </select>
              </div>
              <button className="w-full rounded border border-outline-variant bg-transparent py-1.5 font-label-technical text-label-technical text-on-surface-variant transition-colors hover:bg-surface-container-highest" onClick={resetDemo}>Reset</button>
            </div>
          </div>
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
            <h2 className="mb-4">Live request log</h2>
            <div className="max-h-[280px] overflow-auto">
              <table className="w-full whitespace-nowrap border-collapse text-left">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low font-label-technical text-[10px] uppercase text-outline">
                    <th className="p-3 font-normal">Timestamp (UTC)</th>
                    <th className="p-3 font-normal">Request ID</th>
                    <th className="p-3 font-normal">Algorithm</th>
                    <th className="p-3 font-normal">Status</th>
                    <th className="p-3 text-right font-normal">Latency</th>
                    <th className="p-3 font-normal">State</th>
                  </tr>
                </thead>
                <tbody className="font-code-sm text-[12px] text-on-surface">
                  {events.slice().reverse().map((event, index) => {
                    const state = event.algorithm_state || {};
                    const stateText = event.algorithm === "token_bucket"
                      ? `Tokens: ${(state.tokens ?? 0).toFixed?.(1) ?? state.tokens}/${state.capacity ?? "—"}`
                      : `Count: ${state.count ?? 0}/${state.limit ?? "—"}`;
                    return <tr key={`${event.request_id ?? event.timestamp}-${index}`} className={`cursor-pointer border-b border-outline-variant transition-colors hover:bg-surface-variant ${event.allowed ? "" : "bg-error-container/30"}`}>
                      <td className="p-3 text-outline">{new Date(event.timestamp).toISOString().slice(11, 23)}</td>
                      <td className="p-3 font-medium text-primary">{event.request_id ?? `req_${index}`}</td>
                      <td className="p-3">{event.algorithm.replace("_", " ")}</td>
                      <td className="p-3"><span className={`inline-flex items-center gap-1 ${event.allowed ? "text-primary" : "text-error"}`}><span aria-hidden="true">{event.allowed ? "✓" : "×"}</span>{event.allowed ? "ALLOWED" : "BLOCKED"}</span></td>
                      <td className="p-3 text-right">{event.latency_ms == null ? "—" : `${event.latency_ms}ms`}</td>
                      <td className="p-3 text-outline">{stateText}{!event.allowed && ` · retry ${Math.ceil(event.retry_after)}s`}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
