interface Env {
  DB: D1Database;
}

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

function json(body: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(request) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors(request) });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json(
        { ok: true, brand: "VothostX", parent: "Alphatekx" },
        200,
        request
      );
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404, request);
    }

    if (url.pathname.startsWith("/p/")) {
      const id = url.pathname.slice(3).split("/")[0];
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

    return new Response("VothostX API", { status: 200 });
  },
};
