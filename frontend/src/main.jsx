import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from "recharts";
import "./style.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const algorithms = ["token_bucket", "sliding_window"];

function AlgorithmCard({ algorithm, events }) {
  const recent = events.filter((e) => e.algorithm === algorithm).slice(-20);
  const last = recent.at(-1);
  if (algorithm === "token_bucket") {
    const state = last?.algorithm_state || {};
    const tokens = state.tokens ?? 0,
      capacity = state.capacity ?? 12;
    return (
      <section className="card">
        <h3>Token bucket</h3>
        <div className="gauge">
          <div
            style={{ width: `${Math.min(100, (tokens / capacity) * 100)}%` }}
          />
        </div>
        <strong>
          {tokens.toFixed?.(1) ?? tokens} / {capacity} tokens
        </strong>
        <p>
          Allows a short burst, then refills at {state.refill_rate ?? 2}{" "}
          tokens/sec.
        </p>
        <ResponsiveContainer width="100%" height={105}>
          <BarChart
            data={recent.map((x, i) => ({ i, allowed: x.allowed ? 1 : 0 }))}
          >
            <XAxis dataKey="i" hide />
            <YAxis domain={[0, 1]} hide />
            <Bar dataKey="allowed" fill="#45d4a5" />
          </BarChart>
        </ResponsiveContainer>
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
    [pattern, setPattern] = useState("burst"),
    [login, setLogin] = useState(false);
  const timers = useRef([]);
  useEffect(() => {
    const source = new EventSource(`${API}/demo/stream`);
    source.onmessage = (e) =>
      setEvents((x) => [...x, JSON.parse(e.data)].slice(-100));
    return () => source.close();
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
    const targets = mode === "both" ? algorithms : [mode];
    const send = () => targets.forEach(fire);
    if (pattern === "steady") {
      for (let i = 0; i < 12; i++)
        timers.current.push(setTimeout(send, i * 500));
    } else {
      for (let i = 0; i < 10; i++) send();
      if (pattern === "trickle")
        for (let i = 1; i <= 10; i++)
          timers.current.push(setTimeout(send, i * 800));
    }
  };
  return (
    <main>
      <header>
        <span className="eyebrow">REDIS + FASTAPI + SSE</span>
        <h1>Rate limiter lab</h1>
        <p>Watch the same traffic behave differently under two algorithms.</p>
      </header>
      <div className="layout">
        <section className="controls">
          <h2>Traffic simulator</h2>
          <label>
            Scenario
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            >
              <option value="steady">Steady traffic</option>
              <option value="burst">Burst then idle</option>
              <option value="trickle">Burst then trickle</option>
            </select>
          </label>
          <label>
            Run against
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="both">Side-by-side</option>
              <option value="token_bucket">Token bucket</option>
              <option value="sliding_window">Sliding window</option>
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={login}
              onChange={(e) => setLogin(e.target.checked)}
            />{" "}
            Login brute-force preset
          </label>
          <div className="buttons">
            <button onClick={run}>Run scenario</button>
            <button
              className="secondary"
              onClick={() =>
                (mode === "both" ? algorithms : [mode]).forEach(fire)
              }
            >
              Fire one
            </button>
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
            <AlgorithmCard algorithm="token_bucket" events={events} />
          )}{" "}
          {(mode === "both" || mode === "sliding_window") && (
            <AlgorithmCard algorithm="sliding_window" events={events} />
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
