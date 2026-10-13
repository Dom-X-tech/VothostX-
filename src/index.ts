// ==========================================================
// VothostX Worker — Auth (no verify), API, site host
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
const MIN_PASSWORD_LENGTH = 8;

// The address Resend is allowed to email in testing mode
const OWNER_EMAIL = "domx28718@gmail.com";
const FROM_EMAIL = "VothostX <onboarding@resend.dev>";

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
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}

// ---------- Send notification to owner ----------

async function notifyOwner(
  env: Env,
  subject: string,
  html: string
): Promise<void> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "User-Agent": "VothostX/1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [OWNER_EMAIL],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend notify error:", res.status, errText);
    }
  } catch (e) {
    // Never let email failure break the request
    console.error("notifyOwner failed:", e);
  }
}

// ---------- Worker entry ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Serve generated sites
      if (path.startsWith(PROJECT_PATH_PREFIX)) {
        const id = path.slice(PROJECT_PATH_PREFIX.length).split("/")[0];
        if (id) {
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
          return new Response(notFoundPage(id), {
            status: 404,
            headers: { "content-type": "text/html;charset=utf-8" },
          });
        }
      }

      // Auth
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

      // Projects
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
    } catch (err) {
      console.error("Unhandled error:", err);
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Server error: ${message}` }, 500, request);
    }
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
// AUTH — SIGNUP (no email verification, signs in immediately)
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

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  if (existing) {
    return json(
      { error: "Account already exists. Please sign in." },
      409,
      request
    );
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, verified) VALUES (?, ?, ?, 1)"
  )
    .bind(userId, email, passwordHash)
    .run();

  // Create session immediately — no verification step
  const sid = await createSession(userId, env);

  // Notify the owner (fire and forget — never blocks signup)
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const country = request.headers.get("cf-ipcountry") || "unknown";
  const ua = request.headers.get("user-agent") || "unknown";
  const when = new Date().toISOString();

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;">
      <h2 style="color:#0a0a0a;margin:0 0 12px;">New ${BRAND} signup</h2>
      <p style="color:#555;line-height:1.6;">Someone just created an account.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:8px 12px;background:#f5f5f5;border-radius:6px 0 0 0;"><strong>Email</strong></td><td style="padding:8px 12px;">${email}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f5f5;"><strong>User ID</strong></td><td style="padding:8px 12px;"><code>${userId}</code></td></tr>
        <tr><td style="padding:8px 12px;background:#f5f5f5;"><strong>Time</strong></td><td style="padding:8px 12px;">${when}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f5f5;"><strong>IP</strong></td><td style="padding:8px 12px;">${ip}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f5f5;"><strong>Country</strong></td><td style="padding:8px 12px;">${country}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f5f5;"><strong>User Agent</strong></td><td style="padding:8px 12px;font-size:12px;color:#666;">${ua}</td></tr>
      </table>
      <p style="color:#999;font-size:12px;margin-top:20px;border-top:1px solid #eee;padding-top:12px;">Powered by ${PARENT_BRAND}</p>
    </div>
  `;

  await notifyOwner(env, `New signup: ${email}`, html);

  return json(
    {
      ok: true,
      user: { id: userId, email, verified: 1 },
      message: "Account created.",
    },
    200,
    request,
    { "Set-Cookie": sessionCookie(sid) }
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
    "SELECT id, email, password_hash FROM users WHERE email = ?"
  )
    .bind(email)
    .first<{ id: string; email: string; password_hash: string | null }>();

  if (!user || !user.password_hash) {
    return json({ error: "Invalid email or password" }, 401, request);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return json({ error: "Invalid email or password" }, 401, request);
  }

  const sid = await createSession(user.id, env);

  return json(
    { ok: true, user: { id: user.id, email: user.email, verified: 1 } },
    200,
    request,
    { "Set-Cookie": sessionCookie(sid) }
  );
}

// ============================================================
// AUTH — MAGIC LINK (still sends link to user's inbox — fails for non-owner)
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

  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

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

  // Try sending to the user. Will fail unless user is the owner.
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "User-Agent": "VothostX/1.0",
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
    console.error("Resend magic error:", errText);

    // Fallback: notify owner with the link so they can forward it
    await notifyOwner(
      env,
      `Magic link requested for ${email}`,
      `<p>Someone requested a magic link for <strong>${email}</strong>.</p>
       <p>Link: <a href="${link}">${link}</a></p>`
    );

    return json(
      {
        ok: true,
        message:
          "If that account exists, a link has been sent. (Testing mode: the owner has been notified.)",
      },
      200,
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
// AUTH — VERIFY (used by magic links)
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

function magicEmailHtml(link: string): string {
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f5;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h2 style="margin:0 0 12px;color:#0a0a0a;">Sign in to ${BRAND}</h2>
    <p style="color:#555;line-height:1.6;">Click below to sign in. Expires in ${MAGIC_MINUTES} minutes.</p>
    <p style="text-align:center;margin:32px 0;">
      <a href="${link}" style="background:#10b981;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Sign in</a>
    </p>
    <p style="color:#999;font-size:12px;">Or paste: <span style="color:#10b981;word-break:break-all;">${link}</span></p>
    <p style="color:#999;font-size:12px;border-top:1px solid #eee;padding-top:16px;margin-top:24px;">Powered by ${PARENT_BRAND}</p>
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
