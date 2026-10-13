import { useEffect, useState } from "react";

const API_URL =
  import.meta.env.VITE_API_URL || "https://vothostx.domx28718.workers.dev";

type Health = { ok: boolean; brand: string; parent: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then(async (r) => {
        const text = await r.text();
        if (!text) throw new Error(`Empty response (status ${r.status})`);
        return JSON.parse(text);
      })
      .then(setHealth)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          Vothost<span>X</span>
        </div>
        <div className="parent">Powered by Alphatekx</div>
      </header>

      <main className="main">
        <section className="hero">
          <h1>
            Describe it.
            <br />
            <span>We build &amp; host it.</span>
          </h1>
          <p className="sub">
            VothostX turns a prompt into a complete, hosted website. Create
            files, edit them, and let AI help you build — all in one place.
          </p>
          <a className="cta" href="/signup">
            Get started
          </a>
        </section>

        <section className="features">
          <div className="feature">
            <div className="feature-icon">✦</div>
            <h3>AI-powered generation</h3>
            <p>Turn a sentence into a fully working website in seconds.</p>
          </div>
          <div className="feature">
            <div className="feature-icon">◆</div>
            <h3>File editor</h3>
            <p>Create, upload, and edit HTML, CSS, and JS files directly.</p>
          </div>
          <div className="feature">
            <div className="feature-icon">▲</div>
            <h3>Instant hosting</h3>
            <p>Every project gets its own live URL, hosted on the edge.</p>
          </div>
        </section>

        <div className={`status-line ${error ? "err" : health ? "ok" : ""}`}>
          {error && `API error: ${error}`}
          {health && `API ok · ${health.brand} · Powered by ${health.parent}`}
          {!error && !health && "Connecting to API…"}
        </div>
      </main>

      <footer className="footer">
        Powered by <strong>Alphatekx</strong>
      </footer>
    </div>
  );
}
