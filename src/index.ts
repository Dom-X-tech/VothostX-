// ============================================================
// VothostX — AI Website Builder
// Powered by Alphatekx
// ============================================================

interface Env {
  DB: D1Database;
  GROQ_API_KEY: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ZONE_ID: string;
}

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";
const PRIMARY_DOMAIN = "vothostx.com";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname;

    // --- 1. Serve custom-domain projects ---
    const projectByDomain = await env.DB.prepare(
      "SELECT code FROM projects WHERE custom_domain = ?"
    )
      .bind(host)
      .first<{ code: string }>();

    if (projectByDomain) {
      return new Response(projectByDomain.code, {
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    }

    // --- 2. Serve subdomain projects (projectid.vothostx.com) ---
    if (host.endsWith(`.${PRIMARY_DOMAIN}`)) {
      const subdomain = host.replace(`.${PRIMARY_DOMAIN}`, "");
      if (subdomain && subdomain !== "www") {
        const projectById = await env.DB.prepare(
          "SELECT code FROM projects WHERE id = ?"
        )
          .bind(subdomain)
          .first<{ code: string }>();

        if (projectById) {
          return new Response(projectById.code, {
            headers: { "content-type": "text/html;charset=utf-8" },
          });
        }

        return new Response(notFoundPage(subdomain), {
          status: 404,
          headers: { "content-type": "text/html;charset=utf-8" },
        });
      }
    }

    // --- 3. API routes ---
    if (url.pathname === "/api/generate" && request.method === "POST") {
      return generateSite(request, env);
    }

    if (url.pathname === "/api/connect-domain" && request.method === "POST") {
      return connectDomain(request, env);
    }

    if (url.pathname === "/api/project" && request.method === "GET") {
      return getProject(request, env);
    }

    // --- 4. Landing page ---
    return new Response(landingPage(), {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  },
};

// ============================================================
// 1. Generate Website with Groq
// ============================================================
async function generateSite(request: Request, env: Env): Promise<Response> {
  try {
    const { prompt } = await request.json<{ prompt: string }>();

    if (!prompt || prompt.trim().length === 0) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }

    const groqRes = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
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
      }
    );

    if (!groqRes.ok) {
      const errorText = await groqRes.text();
      console.error("Groq API error:", errorText);
      return Response.json(
        { error: "AI generation failed. Please try again." },
        { status: 500 }
      );
    }

    const data = await groqRes.json<any>();
    let code =
      data.choices?.[0]?.message?.content || "<h1>Generation failed</h1>";

    // Strip markdown fences if the model added them anyway
    code = code
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const id = crypto.randomUUID().slice(0, 8);
    const name = prompt.slice(0, 40);

    await env.DB.prepare(
      "INSERT INTO projects (id, name, prompt, code) VALUES (?, ?, ?, ?)"
    )
      .bind(id, name, prompt, code)
      .run();

    return Response.json({
      id,
      code,
      url: `https://${id}.${PRIMARY_DOMAIN}`,
    });
  } catch (e) {
    console.error("generateSite error:", e);
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}

// ============================================================
// 2. Connect Custom Domain (Cloudflare Custom Hostnames)
// ============================================================
async function connectDomain(request: Request, env: Env): Promise<Response> {
  try {
    const { projectId, domain } = await request.json<{
      projectId: string;
      domain: string;
    }>();

    if (!projectId || !domain) {
      return Response.json(
        { error: "projectId and domain are required" },
        { status: 400 }
      );
    }

    const cleanDomain = domain
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .toLowerCase();

    const project = await env.DB.prepare(
      "SELECT id FROM projects WHERE id = ?"
    )
      .bind(projectId)
      .first();

    if (!project) {
      return Response.json({ error: "Project not found" }, { status: 404 });
    }

    const existing = await env.DB.prepare(
      "SELECT id FROM projects WHERE custom_domain = ?"
    )
      .bind(cleanDomain)
      .first();

    if (existing) {
      return Response.json(
        { error: "Domain already connected to another project" },
        { status: 409 }
      );
    }

    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname: cleanDomain,
          ssl: { method: "http", type: "dv" },
        }),
      }
    );

    const result = await cfRes.json<any>();

    if (!result.success) {
      console.error("Cloudflare API error:", result.errors);
      return Response.json(
        {
          error:
            result.errors?.[0]?.message ||
            "Failed to create custom hostname",
        },
        { status: 400 }
      );
    }

    await env.DB.prepare(
      "UPDATE projects SET custom_domain = ? WHERE id = ?"
    )
      .bind(cleanDomain, projectId)
      .run();

    return Response.json({
      ok: true,
      domain: cleanDomain,
      verification: result.result.ownership_verification,
      ssl: result.result.ssl,
      instructions: [
        `Add a CNAME record pointing "${cleanDomain}" to "${PRIMARY_DOMAIN}"`,
        "Or add the TXT verification record shown in 'verification'",
        "Verification may take a few minutes",
      ],
    });
  } catch (e) {
    console.error("connectDomain error:", e);
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}

// ============================================================
// 3. Get Project Info
// ============================================================
async function getProject(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const project = await env.DB.prepare(
    "SELECT id, name, prompt, custom_domain, created_at FROM projects WHERE id = ?"
  )
    .bind(id)
    .first();

  if (!project) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ project });
}

// ============================================================
// 4. Landing Page
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
  .logo {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }
  .logo span { color: var(--accent); }
  .parent {
    font-size: 12px;
    color: var(--muted);
  }
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
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .actions {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 16px;
  }
  button {
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
  .domain-box {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .domain-box input {
    flex: 1;
    padding: 10px 14px;
    background: #000;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 14px;
  }
  .domain-box button {
    padding: 10px 20px;
    font-size: 14px;
  }
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
  <h1>Describe it. <span>We build & host it.</span></h1>
  <p class="sub">
    Type what you want. ${BRAND} generates a full website and hosts it instantly on its own URL.
    Connect a custom domain with one click.
  </p>

  <textarea id="prompt" placeholder="A landing page for a coffee shop with menu, hours, and location map"></textarea>
  <div class="actions">
    <button id="generateBtn" onclick="generate()">Generate Website</button>
  </div>

  <div id="status"></div>
  <div id="result"></div>
</main>

<footer>Powered by <strong>${PARENT_BRAND}</strong></footer>

<script>
  const btn = document.getElementById('generateBtn');
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  let currentProjectId = null;

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

      currentProjectId = data.id;
      status.innerHTML = '<span class="success">Done! Your site is live.</span>';
      renderPreview(data, prompt);
    } catch (e) {
      status.innerHTML = '<span class="error">Error: ' + e.message + '</span>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Website';
    }
  }

  function renderPreview(data, prompt) {
    const safeCode = data.code.replace(/"/g, '&quot;');
    result.innerHTML = \`
      <iframe srcdoc="\${safeCode}"></iframe>
      <div class="meta">
        <p><strong>Project ID:</strong> <code>\${data.id}</code></p>
        <p><strong>Live URL:</strong> <a href="\${data.url}" target="_blank" style="color:var(--accent);">\${data.url}</a></p>
        <p style="margin-top:16px;"><strong>Connect a custom domain</strong></p>
        <div class="domain-box">
          <input id="domainInput" placeholder="yourdomain.com" />
          <button onclick="connectDomain('\${data.id}')">Connect</button>
        </div>
        <div id="domainStatus" style="margin-top:12px;font-size:13px;"></div>
      </div>
    \`;
  }

  async function connectDomain(projectId) {
    const input = document.getElementById('domainInput');
    const statusEl = document.getElementById('domainStatus');
    const domain = input.value.trim();
    if (!domain) return;

    statusEl.innerHTML = 'Connecting...';
    try {
      const res = await fetch('/api/connect-domain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, domain })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      statusEl.innerHTML = \`
        <span class="success">✓ Domain submitted for verification.</span>
        <p style="margin-top:8px;color:var(--muted);">
          Next: add these DNS records at your domain registrar.
        </p>
        <pre style="background:#000;padding:12px;border-radius:6px;font-size:12px;overflow:auto;margin-top:8px;">CNAME  @  →  ${PRIMARY_DOMAIN}
\${data.verification ? 'TXT  ' + data.verification.name + '  →  ' + data.verification.value : ''}</pre>
      \`;
    } catch (e) {
      statusEl.innerHTML = '<span class="error">' + e.message + '</span>';
    }
  }
</script>
</body>
</html>`;
}

// ============================================================
// 5. 404 Page for missing subdomains
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
</style>
</head>
<body>
<div>
  <h1>404</h1>
  <p>Project <code>${subdomain}</code> not found on ${BRAND}.</p>
  <p style="margin-top:20px;"><a href="https://${PRIMARY_DOMAIN}">← Back to ${BRAND}</a></p>
</div>
</body>
</html>`;
}
