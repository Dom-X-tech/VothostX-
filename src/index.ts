import { useEffect, useState } from "react";

const API_URL =
  import.meta.env.VITE_API_URL || "https://vothostx.domx28718.workers.dev";

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";

type User = { id: string; email: string; verified: number };
type Result = { id: string; code: string; url: string };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [authMsg, setAuthMsg] = useState("");

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  // If the URL has ?token=... → call verify endpoint
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token && window.location.pathname === "/verify") {
      fetch(`${API_URL}/api/auth/verify?token=${token}`, {
        credentials: "include",
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) {
            window.history.replaceState({}, "", "/");
            return fetchMe();
          } else {
            setAuthMsg(`Verification failed: ${d.error}`);
          }
        })
        .finally(() => setLoadingMe(false));
    } else {
      fetchMe();
    }
  }, []);

  async function fetchMe() {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        credentials: "include",
      });
      const data = await res.json();
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoadingMe(false);
    }
  }

  async function requestLink() {
    if (!email.trim()) return;
    setSendingLink(true);
    setAuthMsg("");
    try {
      const res = await fetch(`${API_URL}/api/auth/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAuthMsg("Check your inbox for a sign-in link.");
      setEmail("");
    } catch (e) {
      setAuthMsg(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSendingLink(false);
    }
  }

  async function logout() {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    setResult(null);
  }

  async function generate() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (loadingMe) {
    return (
      <div className="app">
        <div className="loading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          Vothost<span>X</span>
        </div>
        <div className="header-right">
          {user ? (
            <>
              <span className="user-email">{user.email}</span>
              <button className="btn-ghost" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <span className="parent">Powered by {PARENT_BRAND}</span>
          )}
        </div>
      </header>

      <main className="main">
        {!user ? (
          <>
            <h1>
              Sign in to <span>{BRAND}</span>
            </h1>
            <p className="sub">
              Enter your email. We'll send you a one-time link. No password needed.
            </p>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && requestLink()}
              disabled={sendingLink}
            />
            <button
              className="btn"
              onClick={requestLink}
              disabled={sendingLink || !email.trim()}
            >
              {sendingLink ? "Sending…" : "Send sign-in link"}
            </button>
            {authMsg && <p className="status">{authMsg}</p>}
          </>
        ) : (
          <>
            <h1>
              Describe it. <span>We build &amp; host it.</span>
            </h1>
            <p className="sub">
              Type what you want. {BRAND} generates a full website and hosts it.
            </p>

            <textarea
              className="textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A landing page for a coffee shop with menu, hours, and location map"
              disabled={loading}
            />

            <button
              className="btn"
              onClick={generate}
              disabled={loading || !prompt.trim()}
            >
              {loading ? "Generating…" : "Generate Website"}
            </button>

            {error && <p className="error">Error: {error}</p>}
            {loading && <p className="status">AI is writing your website…</p>}

            {result && (
              <>
                <p className="success">Done! Your site is live.</p>
                <iframe
                  className="preview"
                  srcDoc={result.code}
                  sandbox="allow-scripts allow-forms allow-popups allow-modals"
                  title="Preview"
                />
                <div className="meta">
                  <p>
                    <strong>Project ID:</strong> <code>{result.id}</code>
                  </p>
                  <p>
                    <strong>Live URL:</strong>{" "}
                    <a href={result.url} target="_blank" rel="noreferrer">
                      {result.url}
                    </a>
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </main>

      <footer className="footer">
        Powered by <strong>{PARENT_BRAND}</strong>
      </footer>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
.app{display:flex;flex-direction:column;min-height:100vh}
.header{padding:20px 40px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)}
.header-right{display:flex;align-items:center;gap:16px}
.logo{font-size:20px;font-weight:700;letter-spacing:-.5px}
.logo span{color:var(--accent)}
.parent{font-size:12px;color:var(--muted)}
.user-email{font-size:13px;color:var(--muted)}
.main{flex:1;max-width:900px;margin:0 auto;padding:60px 24px;width:100%}
h1{font-size:40px;font-weight:700;letter-spacing:-1px;margin-bottom:12px}
h1 span{color:var(--accent)}
.sub{color:var(--muted);font-size:17px;margin-bottom:40px;line-height:1.6}
.input,.textarea{width:100%;padding:16px;font-size:16px;font-family:inherit;border:1px solid var(--border);border-radius:12px;background:var(--panel);color:var(--text)}
.textarea{height:130px;resize:vertical}
.input:focus,.textarea:focus{outline:none;border-color:var(--accent)}
.input:disabled,.textarea:disabled{opacity:.6}
.btn{margin-top:16px;padding:14px 28px;font-size:15px;font-weight:600;cursor:pointer;background:var(--accent);color:#000;border:none;border-radius:10px}
.btn:hover:not(:disabled){opacity:.85}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px}
.btn-ghost:hover{color:var(--text);border-color:var(--text)}
.status{color:var(--muted);font-size:14px;margin-top:20px}
.error{color:#f87171;font-size:14px;margin-top:20px}
.success{color:var(--accent);font-size:14px;margin-top:24px;margin-bottom:12px}
.loading{display:flex;align-items:center;justify-content:center;min-height:100vh;color:var(--muted)}
.preview{width:100%;height:560px;border:1px solid var(--border);border-radius:12px;background:#fff;margin-top:8px}
.meta{margin-top:20px;padding:20px;background:var(--panel);border:1px solid var(--border);border-radius:12px;font-size:14px;line-height:1.7}
.meta strong{color:var(--accent)}
.meta code{background:#000;padding:2px 8px;border-radius:4px;color:var(--accent);font-size:13px}
.footer{padding:24px;text-align:center;font-size:13px;color:var(--muted);border-top:1px solid var(--border)}
.footer strong{color:var(--text)}
`;
