const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface LoginResponseBody {
  ok?: boolean;
  message?: string;
  retry_after_seconds?: number;
}

export type LoginResult =
  | { kind: "success"; message: string }
  | { kind: "invalid_credentials"; message: string }
  | { kind: "rate_limited"; message: string; retryAfter: number }
  | { kind: "network_error" | "unexpected_error"; message: string };

interface LoginCredentials {
  email: string;
  password: string;
}

async function readJson(response: Response): Promise<LoginResponseBody | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function retryDelay(response: Response, body: LoginResponseBody | null): number {
  const headerDelay = Number(response.headers.get("Retry-After"));
  const bodyDelay = Number(body?.retry_after_seconds);
  const seconds = Number.isFinite(headerDelay) && headerDelay > 0
    ? headerDelay
    : bodyDelay;

  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 1;
}

export async function logIn(
  { email, password }: LoginCredentials,
  { signal }: { signal?: AbortSignal } = {},
): Promise<LoginResult> {
  try {
    const response = await fetch(`${API_URL}/demo/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email.trim(), password }),
      signal,
    });
    const body = await readJson(response);

    if (response.status === 429) {
      const retryAfter = retryDelay(response, body);
      return {
        kind: "rate_limited",
        message: body?.message || `Too many attempts. Try again in ${retryAfter} seconds.`,
        retryAfter,
      };
    }

    if (!response.ok) {
      return {
        kind: "unexpected_error",
        message: "The login service returned an unexpected response. Please try again.",
      };
    }

    if (body?.ok === true) {
      return { kind: "success", message: body.message || "Logged in." };
    }

    if (body?.ok === false) {
      return {
        kind: "invalid_credentials",
        message: "The email or password is incorrect. Please try again.",
      };
    }

    return {
      kind: "unexpected_error",
      message: "The login service returned an unexpected response. Please try again.",
    };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return {
      kind: "network_error",
      message: "We could not reach the login service. Check your connection and try again.",
    };
  }
}
