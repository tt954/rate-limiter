import React, { useEffect, useRef, useState } from "react";
import { logIn } from "../api/login";

const emptyErrors = { email: "", password: "" };

function validateEmail(email) {
  const value = email.trim();
  if (!value) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter an email address in the format name@example.com.";
  }
  return "";
}

function validatePassword(password) {
  return password ? "" : "Enter your password.";
}

export default function LoginPage({ active = true }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState(emptyErrors);
  const [status, setStatus] = useState({ kind: "idle", message: "" });
  const [cooldownEndsAt, setCooldownEndsAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const passwordRef = useRef(null);
  const emailRef = useRef(null);
  const requestRef = useRef(null);

  const cooldownSeconds = Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000));
  const isSubmitting = status.kind === "submitting";
  const isCoolingDown = cooldownSeconds > 0;

  useEffect(() => {
    if (!cooldownEndsAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldownEndsAt]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (active) emailRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (cooldownEndsAt && cooldownSeconds === 0) {
      setCooldownEndsAt(0);
      setStatus({ kind: "idle", message: "You can try logging in again." });
    }
  }, [cooldownEndsAt, cooldownSeconds]);

  const updateField = (field, value) => {
    if (field === "email") setEmail(value);
    else setPassword(value);

    setErrors((current) => ({ ...current, [field]: "" }));
    if (!isCoolingDown && status.kind !== "submitting") {
      setStatus({ kind: "idle", message: "" });
    }
  };

  const validateField = (field) => {
    const message = field === "email"
      ? validateEmail(email)
      : validatePassword(password);
    setErrors((current) => ({ ...current, [field]: message }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting || isCoolingDown) return;

    const nextErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    const controller = new AbortController();
    requestRef.current = controller;
    setStatus({ kind: "submitting", message: "Checking your credentials…" });

    try {
      const result = await logIn({ email, password }, { signal: controller.signal });
      setStatus(result);

      if (result.kind === "success") {
        setPassword("");
      }

      if (result.kind === "invalid_credentials" || result.kind === "rate_limited") {
        setPassword("");
        if (result.kind === "rate_limited") {
          setNow(Date.now());
          setCooldownEndsAt(Date.now() + result.retryAfter * 1000);
        } else {
          requestAnimationFrame(() => passwordRef.current?.focus());
        }
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        setStatus({
          kind: "network_error",
          message: "We could not reach the login service. Check your connection and try again.",
        });
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  const statusMessage = isCoolingDown
    ? `Too many attempts. Try again in ${cooldownSeconds} second${cooldownSeconds === 1 ? "" : "s"}.`
    : status.message;
  const statusTone = status.kind === "success"
    ? "login-status--success"
    : ["invalid_credentials", "rate_limited", "network_error", "unexpected_error"].includes(status.kind)
      ? "login-status--error"
      : "login-status--neutral";

  return (
    <section className="login-page" aria-labelledby="login-title">
      <div className="login-intro">
        <span className="login-eyebrow">Protected interaction</span>
        <h1 id="login-title">Log in to the demo</h1>
        <p>
          Try a real request against the sliding-window protected login endpoint.
          This demo verifies credentials but does not create a persistent session.
        </p>
        <div className="login-policy" aria-label="Login rate-limit policy">
          <div>
            <span>IP limit</span>
            <strong>10 / 60s</strong>
          </div>
          <div>
            <span>Failed account limit</span>
            <strong>5 / 60s</strong>
          </div>
          <div>
            <span>Algorithm</span>
            <strong>Sliding window</strong>
          </div>
        </div>
      </div>

      <div className="login-card">
        <div className="login-card__heading">
          <div className="login-mark" aria-hidden="true">RL</div>
          <div>
            <h2>Welcome back</h2>
            <p>Use any valid email and the demo password.</p>
          </div>
        </div>

        <form noValidate onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="login-email">Email address</label>
            <input
              autoComplete="username"
              autoFocus
              id="login-email"
              inputMode="email"
              ref={emailRef}
              type="email"
              value={email}
              aria-describedby={errors.email ? "login-email-error" : undefined}
              aria-invalid={Boolean(errors.email)}
              onBlur={() => validateField("email")}
              onChange={(event) => updateField("email", event.target.value)}
            />
            {errors.email && <p className="login-field__error" id="login-email-error">{errors.email}</p>}
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <div className="login-password">
              <input
                autoComplete="current-password"
                id="login-password"
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                value={password}
                aria-describedby={errors.password ? "login-password-error login-demo-hint" : "login-demo-hint"}
                aria-invalid={Boolean(errors.password)}
                onBlur={() => validateField("password")}
                onChange={(event) => updateField("password", event.target.value)}
              />
              <button
                className="login-password__toggle"
                type="button"
                aria-label={`${showPassword ? "Hide" : "Show"} password`}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            {errors.password && <p className="login-field__error" id="login-password-error">{errors.password}</p>}
          </div>

          <p className="login-demo-hint" id="login-demo-hint">
            Demo password: <code>correct</code>
          </p>

          <button className="login-submit" type="submit" disabled={isSubmitting || isCoolingDown}>
            {isSubmitting ? "Logging in…" : isCoolingDown ? `Try again in ${cooldownSeconds}s` : "Log in"}
          </button>

          <div
            className={`login-status ${statusTone}`}
            role={status.kind === "invalid_credentials" || status.kind === "rate_limited" ? "alert" : "status"}
            aria-live="polite"
          >
            {statusMessage}
          </div>
        </form>
      </div>
    </section>
  );
}
