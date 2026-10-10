// ============================================================
// VothostX — AI Website Builder
// Powered by Alphatekx
// ============================================================

interface Env {
  DB: D1Database;
  GROQ_API_KEY: string;
}

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";
const PRIMARY_DOMAIN = "vothostx.domx28718.workers.dev";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname;

    // --- Serve subdomain projects: projectid.vothostx.domx28718.workers.dev ---
    if (host.endsWith(`.${PRIMARY_DOMAIN}`) && host !== PRIMARY_DOMAIN) {
      const subdomain = host.replace(`.${PRIMARY_DOMAIN}`, "");

      if (subdomain && subdomain !== "www") {
        try {
          const project = await env.DB.prepare(
            "SELECT code FROM projects WHERE id = ?"
          )
            .bind(subdomain)
            .first<{ code: string }>();

          if (project) {
            return new Response(project.code, {
              headers: { "content-type": "text/html;charset=utf-8" },
            });
          }
        } catch (e) {
          console.error("Subdomain lookup error:", e);
        }

        return new Response(notFoundPage(subdomain), {
          status: 404,
          headers: { "content-type": "text/html;charset=utf-8" },
        });
      }
    }

    // --- API routes ---
    if (url.pathname === "/api/generate" && request.method === "POST") {
      return generateSite(request, env);
    }

    if (url.pathname === "/api/project" && request.method === "GET") {
      return getProject(request, env);
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, brand: BRAND });
    }

    // --- Landing page ---
    return new Response(landingPage(), {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  },
};

// ============================================================
// Generate Website with Groq
// ============================================================
async function generateSite(request: Request, env: Env): Promise<Response> {
  // 1. Parse body
  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return Response.json({ error: "Prompt is required" }, { status: 400 });
  }

  // 2. Check required env
  if (!env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  // 3. Call Groq
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
              "You are VothostX, an AI website generator powered by Alphatekx. " +
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
    return Response.json(
      { error: `Groq unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }

  if (!groqRes.ok) {
    const errText = await groqRes.text();
    console.error("Groq error:", groqRes.status, errText);
    return Response.json(
      { error: `Groq ${groqRes.status}: ${errText.slice(0, 300)}` },
      { status: 500 }
    );
  }

  // 4. Parse Groq response
  let data: any;
  try {
    data = await groqRes.json();
  } catch (e) {
    return Response.json({ error: "Groq returned invalid JSON" }, { status: 502 });
  }

  let code: string = data?.choices?.[0]?.message?.content ?? "";
  if (!code) {
    return Response.json({ error: "Groq returned empty response" }, { status: 502 });
  }

  // 5. Strip markdown fences if the model added them anyway
  code = code
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (!code.toLowerCase().startsWith("<!doctype") && !code.toLowerCase().startsWith("<html")) {
    // Wrap it so it renders
    code = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
      prompt.slice(0, 40)
    )}</title></head><body>${code}</body></html>`;
  }

  // 6. Save to D1
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
    return Response.json(
      {
        error: `Database error: ${e instanceof Error ? e.message : String(e)}`,
      },
      { status: 500 }
    );
  }

  // 7. Return
  return Response.json({
    id,
    code,
    url: `https://${id}.${PRIMARY_DOMAIN}`,
  });
}

// ============================================================
// Get Project Info
// ============================================================
async function getProject(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  try {
    const project = await env.DB.prepare(
      "SELECT id, name, prompt, created_at FROM projects WHERE id = ?"
    )
      .bind(id)
      .first();

    if (!project) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json({ project });
  } catch (e) {
    return Response.json({ error: "Database error" }, { status: 500 });
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

// ============================================================
// Landing Page
// ============================================================
function landingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${BRAND} — AI Website Builder</title>
<meta name="description" content="${BRAND} builds and hosts websites from a single prompt. Powered by ${PARENT_BRAND}.">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0a;
    --panel: #141414;
    --border: #262626;
    --text: #e8e8e8;
    --muted: #888;
    --accent: #6ee7b7;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 20px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }
  .logo { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
  .logo span { color: var(--accent); }
  .parent { font-size: 12px; color: var(--muted); }
  main {
    flex: 1;
    max-width: 900px;
    margin: 0 auto;
    padding: 60px 24px;
    width: 100%;
  }
  h1 {
    font-size: 40px;
    font-weight: 700;
    letter-spacing: -1px;
    margin-bottom: 12px;
  }
  h1 span { color: var(--accent); }
  .sub {
    color: var(--muted);
    font-size: 17px;
    margin-bottom: 40px;
    line-height: 1.6;
  }
  textarea {
    width: 100%;
    height: 130px;
    padding: 16px;
    font-size: 16px;
    font-family: inherit;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    color: var(--text);
    resize: vertical;
    transition: border-color 0.15s;
  }
  textarea:focus { outline: none; border-color: var(--accent); }
  button {
    margin-top: 16px;
    padding: 14px 28px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    background: var(--accent);
    color: #000;
    border: none;
    border-radius: 10px;
    transition: opacity 0.15s;
  }
  button:hover:not(:disabled) { opacity: 0.85; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  #status {
    color: var(--muted);
    font-size: 14px;
    margin-top: 20px;
    min-height: 20px;
  }
  #result { margin-top: 32px; }
  iframe {
    width: 100%;
    height: 560px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #fff;
  }
  .meta {
    margin-top: 20px;
    padding: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    font-size: 14px;
    line-height: 1.7;
  }
  .meta strong { color: var(--accent); }
  .meta code {
    background: #000;
    padding: 2px 8px;
    border-radius: 4px;
    color: var(--accent);
    font-size: 13px;
  }
  .meta a { color: var(--accent); }
  .error { color: #f87171; }
  .success { color: var(--accent); }
  footer {
    padding: 24px;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
    border-top: 1px solid var(--border);
  }
  footer strong { color: var(--text); }
</style>
</head>
<body>
<header>
  <div class="logo">Vothost<span>X</span></div>
  <div class="parent">Powered by ${PARENT_BRAND}</div>
</header>

<main>
  <h1>Describe it. <span>We build &amp; host it.</span></h1>
  <p class="sub">
    Type what you want. ${BRAND} generates a full website and hosts it instantly on its own URL.
  </p>

  <textarea id="prompt" placeholder="A landing page for a coffee shop with menu, hours, and location map"></textarea>
  <button id="generateBtn" onclick="generate()">Generate Website</button>

  <div id="status"></div>
  <div id="result"></div>
</main>

<footer>Powered by <strong>${PARENT_BRAND}</strong></footer>

<script>
  const btn = document.getElementById('generateBtn');
  const status = document.getElementById('status');
  const result = document.getElementById('result');

  async function generate() {
    const prompt = document.getElementById('prompt').value.trim();
    if (!prompt) return;

    btn.disabled = true;
    btn.textContent = 'Generating...';
    status.textContent = 'AI is writing your website...';
    result.innerHTML = '';

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      status.innerHTML = '<span class="success">Done! Your site is live.</span>';

      const safeCode = data.code.replace(/"/g, '&quot;');
      result.innerHTML =
        '<iframe srcdoc="' + safeCode + '"></iframe>' +
        '<div class="meta">' +
          '<p><strong>Project ID:</strong> <code>' + data.id + '</code></p>' +
          '<p><strong>Live URL:</strong> <a href="' + data.url + '" target="_blank">' + data.url + '</a></p>' +
        '</div>';
    } catch (e) {
      status.innerHTML = '<span class="error">Error: ' + e.message + '</span>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Website';
    }
  }
</script>
</body>
</html>`;
}

// ============================================================
// 404 Page
// ============================================================
function notFoundPage(subdomain: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Not Found — ${BRAND}</title>
<style>
  body {
    font-family: system-ui, sans-serif;
    background: #0a0a0a;
    color: #e8e8e8;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
    text-align: center;
  }
  h1 { font-size: 60px; margin: 0; color: #6ee7b7; }
  p { color: #888; margin-top: 12px; }
  a { color: #6ee7b7; text-decoration: none; }
  code { background: #141414; padding: 2px 8px; border-radius: 4px; }
</style>
</head>
<body>
<div>
  <h1>404</h1>
  <p>Project <code>${escapeHtml(subdomain)}</code> not found on ${BRAND}.</p>
  <p style="margin-top:20px;"><a href="https://${PRIMARY_DOMAIN}">← Back to ${BRAND}</a></p>
</div>
</body>
</html>`;
}
