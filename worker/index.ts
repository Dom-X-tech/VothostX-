interface Env {
  DB: D1Database;
  GROQ_API_KEY: string;
}

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";
const SESSION_COOKIE = "vx_session";
const SESSION_DAYS = 30;
const MODEL = "openai/gpt-oss-120b";

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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status: number, request: Request, extra: Record<string, string> = {}): Response {
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

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, km, 256);
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 100000, hash: "SHA-256" }, km, 256);
  const computed = bytesToHex(new Uint8Array(bits));
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

async function getSessionUser(request: Request, env: Env) {
  const sid = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (!sid) return null;
  const s = await env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?").bind(sid).first<{ user_id: string; expires_at: number }>();
  if (!s) return null;
  if (s.expires_at < Math.floor(Date.now() / 1000)) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
    return null;
  }
  return await env.DB.prepare("SELECT id, email FROM users WHERE id = ?").bind(s.user_id).first<{ id: string; email: string }>();
}

function sessionCookie(sid: string): string {
  return [`${SESSION_COOKIE}=${sid}`, "Path=/", "HttpOnly", "Secure", "SameSite=None", `Max-Age=${SESSION_DAYS * 86400}`].join("; ");
}
function clearCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

async function createSession(userId: string, env: Env): Promise<string> {
  const sid = randomToken(32);
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(sid, userId, Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400).run();
  return sid;
}

async function ownsProject(env: Env, userId: string, projectId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").bind(projectId, userId).first();
  return !!row;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request) });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // AUTH
      if (path === "/api/auth/signup" && request.method === "POST") {
        const b = await request.json<{ email?: string; password?: string }>();
        const email = b.email?.trim().toLowerCase();
        const password = b.password ?? "";
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Valid email required" }, 400, request);
        if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400, request);
        const ex = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
        if (ex) return json({ error: "Account already exists" }, 409, request);
        const hash = await hashPassword(password);
        const uid = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").bind(uid, email, hash).run();
        const sid = await createSession(uid, env);
        return json({ ok: true, user: { id: uid, email } }, 200, request, { "Set-Cookie": sessionCookie(sid) });
      }

      if (path === "/api/auth/login" && request.method === "POST") {
        const b = await request.json<{ email?: string; password?: string }>();
        const email = b.email?.trim().toLowerCase();
        const password = b.password ?? "";
        if (!email || !password) return json({ error: "Email and password required" }, 400, request);
        const u = await env.DB.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").bind(email).first<{ id: string; email: string; password_hash: string }>();
        if (!u || !(await verifyPassword(password, u.password_hash))) return json({ error: "Invalid email or password" }, 401, request);
        const sid = await createSession(u.id, env);
        return json({ ok: true, user: { id: u.id, email: u.email } }, 200, request, { "Set-Cookie": sessionCookie(sid) });
      }

      if (path === "/api/auth/me" && request.method === "GET") {
        return json({ user: await getSessionUser(request, env) }, 200, request);
      }

      if (path === "/api/auth/logout" && request.method === "POST") {
        const sid = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
        if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
        return json({ ok: true }, 200, request, { "Set-Cookie": clearCookie() });
      }

      if (path === "/api/health") return json({ ok: true, brand: BRAND, parent: PARENT_BRAND }, 200, request);

      // PROJECTS
      if (path === "/api/projects" && request.method === "GET") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const rows = await env.DB.prepare("SELECT id, name, prompt, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all();
        return json({ projects: rows.results ?? [] }, 200, request);
      }

      if (path === "/api/projects" && request.method === "POST") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const b = await request.json<{ prompt?: string }>();
        const prompt = b.prompt?.trim();
        if (!prompt) return json({ error: "Prompt required" }, 400, request);
        if (!env.GROQ_API_KEY) return json({ error: "GROQ_API_KEY not configured" }, 500, request);

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: "You are VothostX. Return ONLY a complete single-file HTML document. Include CSS in <style> and JS in <script>. No markdown. Start with <!DOCTYPE html>." },
              { role: "user", content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 4096,
          }),
        });

        if (!groqRes.ok) {
          const t = await groqRes.text();
          return json({ error: `Groq ${groqRes.status}: ${t.slice(0, 200)}` }, 500, request);
        }

        const data: any = await groqRes.json();
        let code: string = data?.choices?.[0]?.message?.content ?? "";
        if (!code) return json({ error: "Empty AI response" }, 502, request);
        code = code.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
        if (!code.toLowerCase().startsWith("<!doctype") && !code.toLowerCase().startsWith("<html")) {
          code = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${code}</body></html>`;
        }

        const pid = crypto.randomUUID().slice(0, 8);
        const fid = crypto.randomUUID();
        const name = prompt.slice(0, 60);

        await env.DB.prepare("INSERT INTO projects (id, user_id, name, prompt) VALUES (?, ?, ?, ?)").bind(pid, user.id, name, prompt).run();
        await env.DB.prepare("INSERT INTO files (id, project_id, path, content) VALUES (?, ?, ?, ?)").bind(fid, pid, "index.html", code).run();

        return json({ ok: true, project: { id: pid, name, prompt } }, 200, request);
      }

      const pm = path.match(/^\/api\/projects\/([a-z0-9]+)$/i);
      if (pm && request.method === "GET") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const project = await env.DB.prepare("SELECT id, name, prompt, created_at FROM projects WHERE id = ? AND user_id = ?").bind(pm[1], user.id).first();
        if (!project) return json({ error: "Not found" }, 404, request);
        return json({ project }, 200, request);
      }

      if (pm && request.method === "DELETE") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        await env.DB.prepare("DELETE FROM files WHERE project_id = ?").bind(pm[1]).run();
        await env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").bind(pm[1], user.id).run();
        return json({ ok: true }, 200, request);
      }

      // FILES
      if (path === "/api/files" && request.method === "GET") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return json({ error: "projectId required" }, 400, request);
        if (!(await ownsProject(env, user.id, projectId))) return json({ error: "Not found" }, 404, request);
        const rows = await env.DB.prepare("SELECT id, path, updated_at FROM files WHERE project_id = ? ORDER BY path").bind(projectId).all();
        return json({ files: rows.results ?? [] }, 200, request);
      }

      if (path === "/api/files" && request.method === "POST") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const b = await request.json<{ projectId?: string; path?: string; content?: string }>();
        if (!b.projectId || !b.path) return json({ error: "projectId and path required" }, 400, request);
        if (!(await ownsProject(env, user.id, b.projectId))) return json({ error: "Not found" }, 404, request);
        const fid = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO files (id, project_id, path, content) VALUES (?, ?, ?, ?)")
          .bind(fid, b.projectId, b.path, b.content ?? "").run();
        return json({ ok: true, file: { id: fid, path: b.path, content: b.content ?? "" } }, 200, request);
      }

      const fm = path.match(/^\/api\/files\/([a-z0-9-]+)$/i);
      if (fm && request.method === "GET") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const f = await env.DB.prepare("SELECT f.id, f.project_id, f.path, f.content, f.updated_at FROM files f JOIN projects p ON p.id = f.project_id WHERE f.id = ? AND p.user_id = ?")
          .bind(fm[1], user.id).first();
        if (!f) return json({ error: "Not found" }, 404, request);
        return json({ file: f }, 200, request);
      }

      if (fm && request.method === "PUT") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const b = await request.json<{ content?: string }>();
        const f = await env.DB.prepare("SELECT f.id FROM files f JOIN projects p ON p.id = f.project_id WHERE f.id = ? AND p.user_id = ?").bind(fm[1], user.id).first();
        if (!f) return json({ error: "Not found" }, 404, request);
        await env.DB.prepare("UPDATE files SET content = ?, updated_at = unixepoch() WHERE id = ?").bind(b.content ?? "", fm[1]).run();
        return json({ ok: true }, 200, request);
      }

      if (fm && request.method === "DELETE") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const f = await env.DB.prepare("SELECT f.id FROM files f JOIN projects p ON p.id = f.project_id WHERE f.id = ? AND p.user_id = ?").bind(fm[1], user.id).first();
        if (!f) return json({ error: "Not found" }, 404, request);
        await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fm[1]).run();
        return json({ ok: true }, 200, request);
      }

      // AI EDIT
      if (path === "/api/ai/edit" && request.method === "POST") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Sign in required" }, 401, request);
        const b = await request.json<{ fileId?: string; instruction?: string }>();
        if (!b.fileId || !b.instruction) return json({ error: "fileId and instruction required" }, 400, request);
        const f = await env.DB.prepare("SELECT f.id, f.path, f.content FROM files f JOIN projects p ON p.id = f.project_id WHERE f.id = ? AND p.user_id = ?").bind(b.fileId, user.id).first<{ id: string; path: string; content: string }>();
        if (!f) return json({ error: "File not found" }, 404, request);
        if (!env.GROQ_API_KEY) return json({ error: "GROQ_API_KEY not configured" }, 500, request);

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: "system", content: `You are a code editor. The user is editing the file "${f.path}". Return ONLY the complete updated file content. No markdown, no explanations.` },
              { role: "user", content: `Current content:\n\n${f.content}\n\n---\n\nRequest: ${b.instruction}` },
            ],
            temperature: 0.3,
            max_tokens: 4096,
          }),
        });

        if (!groqRes.ok) {
          const t = await groqRes.text();
          return json({ error: `Groq ${groqRes.status}: ${t.slice(0, 200)}` }, 500, request);
        }

        const data: any = await groqRes.json();
        let newContent: string = data?.choices?.[0]?.message?.content ?? "";
        newContent = newContent.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/i, "").trim();
        if (!newContent) return json({ error: "Empty AI response" }, 502, request);
        return json({ ok: true, content: newContent }, 200, request);
      }

      // SERVE GENERATED SITES
      if (path.startsWith("/p/")) {
        const rest = path.slice(3);
        const id = rest.split("/")[0];
        const filePath = rest.slice(id.length + 1) || "index.html";

        const file = await env.DB.prepare("SELECT content, path FROM files WHERE project_id = ? AND path = ?").bind(id, filePath).first<{ content: string; path: string }>();
        if (file) {
          const ct = filePath.endsWith(".css") ? "text/css" : filePath.endsWith(".js") ? "text/javascript" : filePath.endsWith(".json") ? "application/json" : "text/html";
          return new Response(file.content, { headers: { "content-type": `${ct};charset=utf-8` } });
        }

        const index = await env.DB.prepare("SELECT content FROM files WHERE project_id = ? AND path = 'index.html'").bind(id).first<{ content: string }>();
        if (index) return new Response(index.content, { headers: { "content-type": "text/html;charset=utf-8" } });
        return new Response("Not found", { status: 404 });
      }

      if (path.startsWith("/api/")) return json({ error: "Not found" }, 404, request);
      return new Response("VothostX API", { status: 200 });
    } catch (err) {
      console.error("Unhandled:", err);
      return json({ error: `Server error: ${err instanceof Error ? err.message : String(err)}` }, 500, request);
    }
  },
};
