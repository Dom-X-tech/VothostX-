interface Env {
  DB: D1Database;
}

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        brand: BRAND,
        parent: PARENT_BRAND,
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
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

      return new Response("Site not found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
