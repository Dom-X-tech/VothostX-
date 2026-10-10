// ============================================================
// VothostX Worker — API + generated-site host
// Powered by Alphatekx
// ============================================================

interface Env {
  DB: D1Database;
  GROQ_API_KEY: string;
}

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const PROJECT_PATH_PREFIX = "/p/";

// CORS — allow the Pages editor to call this Worker
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    // --- 1. Serve generated sites at /p/:id ---
    if (url.pathname.startsWith(PROJECT_PATH_PREFIX)) {
      const id = url.pathname.slice(PROJECT_PATH_PREFIX.length).split("/")[0];
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

    // --- 2. API routes ---
    if (url.pathname === "/api/generate" && request.method === "POST") {
      return generateSite(request, env);
    }

    if (url.pathname === "/api/project" && request.method === "GET") {
      return getProject(request, env);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, brand: BRAND, parent: PARENT_BRAND });
    }

    // --- 3. Root: informational page (the real editor lives on Pages) ---
    return new Response(rootPage(), {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  },
};

// ============================================================
// Generate Website
// ============================================================
async function generateSite(request: Request, env: Env): Promise<Response> {
  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be valid JSON" }, 400);
  }

  const prompt = body.prompt?.trim();
  if (!prompt) return json({ error: "Prompt is required" }, 400);

  if (!env.GROQ_API_KEY) {
    return json({ error: "GROQ_API_KEY not configured on server" }, 500);
  }

  let groqRes: Response;
  try {
    groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
              "Do NOT wrap the output in markdown. Do NOT add explanations. " +
              "Return raw HTML starting with <!DOCTYPE html> and nothing else.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });
  } catch (e) {
    console.error("Groq fetch failed:", e);
    return json(
      { error: `Groq unreachable: ${e instanceof Error ? e.message : String(e)}` },
      502
    );
  }

  if (!groqRes.ok) {
    const errText = await groqRes.text();
    console.error("Groq error:", groqRes.status, errText);
    return json(
      { error: `Groq ${groqRes.status}: ${errText.slice(0, 300)}` },
      500
    );
  }

  let data: any;
  try {
    data = await groqRes.json();
  } catch {
    return json({ error: "Groq returned invalid JSON" }, 502);
  }

  let code: string = data?.choices?.[0]?.message?.content ?? "";
  if (!code) return json({ error: "Groq returned empty response" }, 502);

  code = code
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (
    !code.toLowerCase().startsWith("<!doctype") &&
    !code.toLowerCase().startsWith("<html")
  ) {
    code = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
      prompt.slice(0, 40)
    )}</title></head><body>${code}</body></html>`;
  }

  const id = crypto.randomUUID().slice(0, 8);
  const name = prompt.slice(0, 40);

  try {
    await env.DB.prepare(
      "INSERT INTO projects (id, name, prompt, code) VALUES (?, ?, ?, ?)"
    )
      .bind(id, name, prompt, code)
      .run();
  } catch (e) {
    console.error("D1 insert failed:", e);
    return json(
      { error: `Database error: ${e instanceof Error ? e.message : String(e)}` },
      500
    );
  }

  const origin = new URL(request.url).origin;
  return json({
    id,
    code,
    url: `${origin}${PROJECT_PATH_PREFIX}${id}`,
  });
}

// ============================================================
// Get Project Info
// ============================================================
async function getProject(request: Request, env: Env): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "id required" }, 400);

  try {
    const project = await env.DB.prepare(
      "SELECT id, name, prompt, created_at FROM projects WHERE id = ?"
    )
      .bind(id)
      .first();

    if (!project) return json({ error: "Not found" }, 404);
    return json({ project });
  } catch {
    return json({ error: "Database error" }, 500);
  }
}

// ============================================================
// Helpers
// ============================================================
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rootPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${BRAND} API</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0a0a0a; color: #e8e8e8;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; text-align: center;
    padding: 20px;
  }
  .card { max-width: 520px; }
  h1 { color: #6ee7b7; font-size: 32px; margin: 0 0 8px; }
  .sub { color: #888; font-size: 14px; margin-bottom: 28px; }
  ul { list-style: none; padding: 0; text-align: left; }
  li {
    background: #141414; border: 1px solid #262626;
    border-radius: 10px; padding: 14px 18px; margin-bottom: 10px;
    font-size: 14px;
  }
  code { color: #6ee7b7; font-size: 13px; }
  a { color: #6ee7b7; text-decoration: none; }
  .tag {
    display: inline-block; font-size: 11px; padding: 2px 8px;
    border-radius: 4px; margin-right: 8px;
    background: #1f2937; color: #9ca3af;
  }
  .footer { margin-top: 30px; color: #555; font-size: 12px; }
</style>
</head>
<body>
<div class="card">
  <h1>${BRAND} API</h1>
  <p class="sub">Powered by ${PARENT_BRAND}</p>
  <ul>
    <li><span class="tag">POST</span><code>/api/generate</code> — generate a website</li>
    <li><span class="tag">GET</span><code>/api/project?id=xxx</code> — fetch project</li>
    <li><span class="tag">GET</span><code>/api/health</code> — health check</li>
    <li><span class="tag">GET</span><code>/p/:id</code> — serve a generated site</li>
  </ul>
  <p class="sub" style="margin-top:24px;">
    The editor lives at
    <a href="https://vhostx.zone.id">vhostx.zone.id</a>
  </p>
  <div class="footer">Powered by ${PARENT_BRAND}</div>
</div>
</body>
</html>`;
}

function notFoundPage(id: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Not Found — ${BRAND}</title>
<style>
  body {
    font-family: system-ui, sans-serif;
    background: #0a0a0a; color: #e8e8e8;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; text-align: center;
  }
  h1 { font-size: 60px; margin: 0; color: #6ee7b7; }
  p { color: #888; margin-top: 12px; }
  code { background: #141414; padding: 2px 8px; border-radius: 4px; }
  a { color: #6ee7b7; text-decoration: none; }
</style>
</head>
<body>
<div>
  <h1>404</h1>
  <p>Project <code>${escapeHtml(id)}</code> not found.</p>
  <p style="margin-top:20px;">
    <a href="https://vhostx.zone.id">← Back to ${BRAND}</a>
  </p>
</div>
</body>
</html>`;
}
