interface Env {
  DB: D1Database;
}

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";
const SESSION_COOKIE = "vx_session";
const SESSION_DAYS = 30;

const ALLOWED_ORIGINS = [
  "https://vothostx.pages.dev",
  "https://vhostx.zone.id",
  "http://localhost:5173",
];

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function json(
  body: unknown,
  status: number,
  request: Request,
  extra: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(request), ...extra },
  });
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = hexToBytes(saltHex);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const computed = bytesToHex(new Uint8Array(bits));
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

async function getSessionUser(request: Request, env: Env) {
  const cookies = parseCookies(request.headers.get("cookie"));
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;

  const session = await env.DB.prepare(
    "SELECT user_id, expires_at FROM sessions WHERE id = ?"
  )
    .bind(sid)
    .first<{ user_id: string; expires_at: number }>();

  if (!session) return null;
  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
    return null;
  }

  return await env.DB.prepare(
    "SELECT id, email FROM users WHERE id = ?"
  )
    .bind(session.user_id)
    .first<{ id: string; email: string }>();
}

function sessionCookie(sid: string): string {
  return [
    `${SESSION_COOKIE}=${sid}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${SESSION_DAYS * 86400}`,
  ].join("; ");
}

function clearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

async function createSession(userId: string, env: Env): Promise<string> {
  const sid = randomToken(32);
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
  )
    .bind(sid, userId, expires)
    .run();
  return sid;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---------- AUTH ----------
      if (path === "/api/auth/signup" && request.method === "POST") {
        const body = await request.json<{ email?: string; password?: string }>();
        const email = body.email?.trim().toLowerCase();
        const password = body.password ?? "";

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: "Valid email required" }, 400, request);
        }
        if (password.length < 8) {
          return json({ error: "Password must be at least 8 characters" }, 400, request);
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ?"
        )
          .bind(email)
          .first();

        if (existing) {
          return json({ error: "Account already exists. Please sign in." }, 409, request);
        }

        const passwordHash = await hashPassword(password);
        const userId = crypto.randomUUID();

        await env.DB.prepare(
          "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)"
        )
          .bind(userId, email, passwordHash)
          .run();

        const sid = await createSession(userId, env);

        return json(
          { ok: true, user: { id: userId, email } },
          200,
          request,
          { "Set-Cookie": sessionCookie(sid) }
        );
      }

      if (path === "/api/auth/login" && request.method === "POST") {
        const body = await request.json<{ email?: string; password?: string }>();
        const email = body.email?.trim().toLowerCase();
        const password = body.password ?? "";

        if (!email || !password) {
          return json({ error: "Email and password required" }, 400, request);
        }

        const user = await env.DB.prepare(
          "SELECT id, email, password_hash FROM users WHERE email = ?"
        )
          .bind(email)
          .first<{ id: string; email: string; password_hash: string }>();

        if (!user) {
          return json({ error: "Invalid email or password" }, 401, request);
        }

        const ok = await verifyPassword(password, user.password_hash);
        if (!ok) {
          return json({ error: "Invalid email or password" }, 401, request);
        }

        const sid = await createSession(user.id, env);

        return json(
          { ok: true, user: { id: user.id, email: user.email } },
          200,
          request,
          { "Set-Cookie": sessionCookie(sid) }
        );
      }

      if (path === "/api/auth/me" && request.method === "GET") {
        const user = await getSessionUser(request, env);
        return json({ user }, 200, request);
      }

      if (path === "/api/auth/logout" && request.method === "POST") {
        const cookies = parseCookies(request.headers.get("cookie"));
        const sid = cookies[SESSION_COOKIE];
        if (sid) {
          await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
        }
        return json({ ok: true }, 200, request, { "Set-Cookie": clearCookie() });
      }

      // ---------- HEALTH ----------
      if (path === "/api/health") {
        return json(
          { ok: true, brand: BRAND, parent: PARENT_BRAND },
          200,
          request
        );
      }

      // ---------- GENERATED SITES ----------
      if (path.startsWith("/p/")) {
        const id = path.slice(3).split("/")[0];
        const row = await env.DB.prepare(
          "SELECT code FROM projects WHERE id = ?"
        )
          .bind(id)
          .first<{ code: string }>();

        if (row) {
          return new Response(row.code, {
            headers: { "content-type": "text/html;charset=utf-8" },
          });
        }
        return new Response("Site not found", { status: 404 });
      }

      // ---------- FALLBACK ----------
      if (path.startsWith("/api/")) {
        return json({ error: "Not found" }, 404, request);
      }

      return new Response("VothostX API", { status: 200 });
    } catch (err) {
      console.error("Unhandled error:", err);
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Server error: ${message}` }, 500, request);
    }
  },
};
