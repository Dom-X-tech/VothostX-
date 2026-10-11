// ============================================================
// VothostX Worker — Password + Magic-link auth, API, site host
// Powered by Alphatekx
// ============================================================

interface Env {
  DB: D1Database;
  GROQ_API_KEY: string;
  RESEND_API_KEY: string;
}

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const PROJECT_PATH_PREFIX = "/p/";
const SESSION_COOKIE = "vx_session";
const SESSION_DAYS = 30;
const MAGIC_MINUTES = 15;
const VERIFY_HOURS = 24;
const FROM_EMAIL = "VothostX <onboarding@resend.dev>";
const MIN_PASSWORD_LENGTH = 8;

const ALLOWED_ORIGINS = [
  "https://vothostx.pages.dev",
  "https://vhostx.zone.id",
  "http://localhost:5173",
];

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function json(
  body: unknown,
  status: number,
  request: Request,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(request),
      ...extraHeaders,
    },
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

// ---------- Password hashing (PBKDF2 via Web Crypto) ----------

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
  // constant-time-ish compare
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

// ---------- Worker entry ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ---- Serve generated sites ----
    if (path.startsWith(PROJECT_PATH_PREFIX)) {
      const id = path.slice(PROJECT_PATH_PREFIX.length).split("/")[0];
      if (id) {
        try {
          const project = await env.DB.prepare(
            "SELECT code FROM projects WHERE id = ?"
          )
            .bind(id)
            .first<{ code: string }>();
          if (project) {
            return new Response(project.code, {
              headers: { "content-type": "text/html;charset=utf-8" },
            });
          }
        } catch (e) {
          console.error("Project lookup error:", e);
        }
        return new Response(notFoundPage(id), {
          status: 404,
          headers: { "content-type": "text/html;charset=utf-8" },
        });
      }
    }

    // ---- Auth routes ----
    if (path === "/api/auth/signup" && request.method === "POST") {
      return authSignup(request, env);
    }
    if (path === "/api/auth/login" && request.method === "POST") {
      return authLogin(request, env);
    }
    if (path === "/api/auth/request" && request.method === "POST") {
      return authRequestMagic(request, env);
    }
    if (path === "/api/auth/verify" && request.method === "GET") {
      return authVerify(request, env);
    }
    if (path === "/api/auth/me" && request.method === "GET") {
      return authMe(request, env);
    }
    if (path === "/api/auth/logout" && request.method === "POST") {
      return authLogout(request, env);
    }

    // ---- Project routes ----
    if (path === "/api/generate" && request.method === "POST") {
      return generateSite(request, env);
    }
    if (path === "/api/projects" && request.method === "GET") {
      return listProjects(request, env);
    }
    if (path === "/api/project" && request.method === "GET") {
      return getProject(request, env);
    }

    if (path === "/api/health") {
      return json({ ok: true, brand: BRAND, parent: PARENT_BRAND }, 200, request);
    }

    return new Response(rootPage(), {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  },
};

// ============================================================
// SESSION HELPERS
// ============================================================

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

  const user = await env.DB.prepare(
    "SELECT id, email, verified FROM users WHERE id = ?"
  )
    .bind(session.user_id)
    .first<{ id: string; email: string; verified: number }>();

  return user ?? null;
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

// ============================================================
// AUTH — SIGNUP
// ============================================================

async function authSignup(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Valid email required" }, 400, request);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      400,
      request
    );
  }

  const existing = await env.DB.prepare(
    "SELECT id, verified FROM users WHERE email = ?"
  )
    .bind(email)
    .first<{ id: string; verified: number }>();

  if (existing && existing.verified) {
    return json(
      { error: "Account already exists. Please sign in." },
      409,
      request
    );
  }

  const passwordHash = await hashPassword(password);

  let userId: string;
  if (existing) {
    // User existed but wasn't verified — update password and resend verification
    userId = existing.id;
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(passwordHash, userId)
      .run();
  } else {
    userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, verified) VALUES (?, ?, ?, 0)"
    )
      .bind(userId, email, passwordHash)
      .run();
  }

  // Send verification email
  const token = randomToken(32);
  const expiresAt = Math.floor(Date.now() / 1000) + VERIFY_HOURS * 3600;

  await env.DB.prepare(
    "INSERT INTO magic_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)"
  )
    .bind(token, userId, expiresAt)
    .run();

  const origin = request.headers.get("origin") || "https://vothostx.pages.dev";
  const link = `${origin}/verify?token=${token}`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: `Verify your ${BRAND} account`,
      html: verifyEmailHtml(link),
    }),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error("Resend error:", emailRes.status, errText);
    return json(
      { error: `Email send failed: ${errText.slice(0, 200)}` },
      500,
      request
    );
  }

  return json(
    {
      ok: true,
      message: "Account created. Check your inbox to verify your email.",
    },
    200,
    request
  );
}

// ============================================================
// AUTH — LOGIN
// ============================================================

async function authLogin(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) {
    return json({ error: "Email and password required" }, 400, request);
  }

  const user = await env.DB.prepare(
    "SELECT id, email, password_hash, verified FROM users WHERE email = ?"
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      password_hash: string | null;
      verified: number;
    }>();

  if (!user || !user.password_hash) {
    return json({ error: "Invalid email or password" }, 401, request);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return json({ error: "Invalid email or password" }, 401, request);
  }

  if (!user.verified) {
    return json(
      { error: "Please verify your email first. Check your inbox." },
      403,
      request
    );
  }

  const sid = await createSession(user.id, env);

  return json(
    {
      ok: true,
      user: { id: user.id, email: user.email, verified: user.verified },
    },
    200,
    request,
    { "Set-Cookie": sessionCookie(sid) }
  );
}

// ============================================================
// AUTH — MAGIC LINK REQUEST
// ============================================================

async function authRequestMagic(request: Request, env: Env): Promise<Response> {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request);
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Valid email required" }, 400, request);
  }

  const user = await env.DB.prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string }>();

  // Don't leak whether the account exists — always respond success
  if (!user) {
    return json(
      { ok: true, message: "If that account exists, a link has been sent." },
      200,
      request
    );
  }

  const token = randomToken(32);
  const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_MINUTES * 60;

  await env.DB.prepare(
    "INSERT INTO magic_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)"
  )
    .bind(token, user.id, expiresAt)
    .run();

  const origin = request.headers.get("origin") || "https://vothostx.pages.dev";
  const link = `${origin}/verify?token=${token}`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: `Sign in to ${BRAND}`,
      html: magicEmailHtml(link),
    }),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error("Resend error:", emailRes.status, errText);
    return json(
      { error: `Email send failed: ${errText.slice(0, 200)}` },
      500,
      request
    );
  }

  return json(
    { ok: true, message: "Check your inbox for a sign-in link." },
    200,
    request
  );
}

// ============================================================
// AUTH — VERIFY (works for both signup-verify and magic link)
// ============================================================

async function authVerify(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return json({ error: "Missing token" }, 400, request);

  const row = await env.DB.prepare(
    "SELECT user_id, expires_at, used FROM magic_tokens WHERE token = ?"
  )
    .bind(token)
    .first<{ user_id: string; expires_at: number; used: number }>();

  if (!row) return json({ error: "Invalid link" }, 400, request);
  if (row.used) return json({ error: "Link already used" }, 400, request);
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    return json({ error: "Link expired" }, 400, request);
  }

  await env.DB.prepare("UPDATE magic_tokens SET used = 1 WHERE token = ?")
    .bind(token)
    .run();
  await env.DB.prepare("UPDATE users SET verified = 1 WHERE id = ?")
    .bind(row.user_id)
    .run();

  const sid = await createSession(row.user_id, env);

  return json({ ok: true, message: "Signed in" }, 200, request, {
    "Set-Cookie": sessionCookie(sid),
  });
}

// ============================================================
// AUTH — ME / LOGOUT
// ============================================================

async function authMe(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) return json({ user: null }, 200, request);
  return json(
    { user: { id: user.id, email: user.email, verified: user.verified } },
    200,
    request
  );
}

async function authLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const sid = cookies[SESSION_COOKIE];
  if (sid) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  }
  return json({ ok: true }, 200, request, { "Set-Cookie": clearCookie() });
}

// ============================================================
// GENERATE
// ============================================================

async function generateSite(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Sign in required" }, 401, request);

  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be valid JSON" }, 400, request);
  }

  const prompt = body.prompt?.trim();
  if (!prompt) return json({ error: "Prompt is required" }, 400, request);
  if (!env.GROQ_API_KEY)
    return json({ error: "GROQ_API_KEY not configured" }, 500, request);

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content:
            `You are ${BRAND}, an AI website generator powered by ${PARENT_BRAND}. ` +
            "Return ONLY a complete, valid, single-file HTML document. " +
            "Include all CSS inside a <style> tag and all JavaScript inside a <script> tag. " +
            "Do NOT wrap the output in markdown. Return raw HTML starting with <!DOCTYPE html> and nothing else.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!groqRes.ok) {
    const errText = await groqRes.text();
    console.error("Groq error:", groqRes.status, errText);
    return json(
      { error: `Groq ${groqRes.status}: ${errText.slice(0, 200)}` },
      500,
      request
    );
  }

  const data: any = await groqRes.json();
  let code: string = data?.choices?.[0]?.message?.content ?? "";
  if (!code) return json({ error: "Empty AI response" }, 502, request);

  code = code
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (
    !code.toLowerCase().startsWith("<!doctype") &&
    !code.toLowerCase().startsWith("<html")
  ) {
    code = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${code}</body></html>`;
  }

  const id = crypto.randomUUID().slice(0, 8);
  await env.DB.prepare(
    "INSERT INTO projects (id, name, prompt, code, user_id) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, prompt.slice(0, 40), prompt, code, user.id)
    .run();

  const origin = new URL(request.url).origin;
  return json(
    { id, code, url: `${origin}${PROJECT_PATH_PREFIX}${id}` },
    200,
    request
  );
}

async function listProjects(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Sign in required" }, 401, request);
  const rows = await env.DB.prepare(
    "SELECT id, name, prompt, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
  )
    .bind(user.id)
    .all();
  return json({ projects: rows.results ?? [] }, 200, request);
}

async function getProject(request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: "Sign in required" }, 401, request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400, request);
  const project = await env.DB.prepare(
    "SELECT id, name, prompt, code, created_at FROM projects WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first();
  if (!project) return json({ error: "Not found" }, 404, request);
  return json({ project }, 200, request);
}

// ============================================================
// Email templates
// ============================================================

function verifyEmailHtml(link: string): string {
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f5;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h2 style="margin:0 0 12px;color:#0a0a0a;">Verify your ${BRAND} account</h2>
    <p style="color:#555;line-height:1.6;">
      Click the button below to verify your email and finish signing up. This link expires in ${VERIFY_HOURS} hours.
    </p>
    <p style="text-align:center;margin:32px 0;">
      <a href="${link}" style="background:#10b981;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Verify email
      </a>
    </p>
    <p style="color:#999;font-size:12px;margin-top:32px;">
      Or paste this into your browser:<br>
      <span style="color:#10b981;word-break:break-all;">${link}</span>
    </p>
    <p style="color:#999;font-size:12px;border-top:1px solid #eee;padding-top:16px;margin-top:24px;">
      Powered by ${PARENT_BRAND}
    </p>
  </div>
</body></html>`;
}

function magicEmailHtml(link: string): string {
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f5;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h2 style="margin:0 0 12px;color:#0a0a0a;">Sign in to ${BRAND}</h2>
    <p style="color:#555;line-height:1.6;">
      Click the button below to sign in. This link expires in ${MAGIC_MINUTES} minutes and can only be used once.
    </p>
    <p style="text-align:center;margin:32px 0;">
      <a href="${link}" style="background:#10b981;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Sign in
      </a>
    </p>
    <p style="color:#999;font-size:12px;margin-top:32px;">
      Or paste this into your browser:<br>
      <span style="color:#10b981;word-break:break-all;">${link}</span>
    </p>
    <p style="color:#999;font-size:12px;border-top:1px solid #eee;padding-top:16px;margin-top:24px;">
      Powered by ${PARENT_BRAND}
    </p>
  </div>
</body></html>`;
}

function rootPage(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${BRAND} API</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}h1{color:#6ee7b7}</style>
</head><body><div><h1>${BRAND} API</h1><p>Powered by ${PARENT_BRAND}</p></div></body></html>`;
}

function notFoundPage(id: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}h1{font-size:60px;color:#6ee7b7;margin:0}</style>
</head><body><div><h1>404</h1><p>Project not found.</p></div></body></html>`;
}
