import { useEffect, useState } from "react";

const API_URL =
  import.meta.env.VITE_API_URL || "https://vothostx.domx28718.workers.dev";

const BRAND = "VothostX";
const PARENT_BRAND = "Alphatekx";

type User = { id: string; email: string; verified: number };
type Result = { id: string; code: string; url: string };
type Mode = "signin" | "signup" | "magic" | "sent" | "verify-failed";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  // Auth UI state
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState("");
  const [authErr, setAuthErr] = useState("");

  // Generator state
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  // Handle /verify?token=xxx on first load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const isVerifyPath = window.location.pathname === "/verify";

    if (token && isVerifyPath) {
      fetch(`${API_URL}/api/auth/verify?token=${token}`, {
        credentials: "include",
      })
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (ok && d.ok) {
            window.history.replaceState({}, "", "/");
            return fetchMe();
          } else {
            setMode("verify-failed");
            setAuthErr(d.error || "Verification failed");
          }
        })
        .catch(() => {
          setMode("verify-failed");
          setAuthErr("Verification failed");
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

  function resetAuth() {
    setAuthErr("");
    setAuthMsg("");
  }

  async function doSignup() {
    resetAuth();
    if (password !== confirm) {
      setAuthErr("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setAuthErr("Password must be at least 8 characters");
      return;
    }
    setAuthBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMode("sent");
      setAuthMsg("Account created. Check your inbox to verify your email.");
      setPassword("");
      setConfirm("");
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "Signup failed");
    } finally {
      setAuthBusy(false);
    }
  }

  async function doLogin() {
    resetAuth();
    setAuthBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUser(data.user);
      setEmail("");
      setPassword("");
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setAuthBusy(false);
    }
  }

  async function doMagicLink() {
    resetAuth();
    setAuthBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMode("sent");
      setAuthMsg("Check your inbox for a sign-in link.");
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "Failed to send link");
    } finally {
      setAuthBusy(false);
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

  // ---------------- Auth screen ----------------
  if (!user) {
    return (
      <div className="app">
        <header className="header">
          <div className="logo">
            Vothost<span>X</span>
          </div>
          <div className="parent">Powered by {PARENT_BRAND}</div>
        </header>

        <main className="main narrow">
          {mode === "verify-failed" && (
            <>
              <h1>Verification failed</h1>
              <p className="sub">{authErr}</p>
              <button className="btn" onClick={() => setMode("signin")}>
                Back to sign in
              </button>
            </>
          )}

          {mode === "sent" && (
            <>
              <h1>Check your inbox</h1>
              <p className="sub">{authMsg}</p>
              <button className="btn-ghost" onClick={() => setMode("signin")}>
                Back to sign in
              </button>
            </>
          )}

          {(mode === "signin" || mode === "signup" || mode === "magic") && (
            <>
              <h1>
                {mode === "signup" && <>Create your <span>{BRAND}</span> account</>}
                {mode === "signin" && <>Welcome back to <span>{BRAND}</span></>}
                {mode === "magic" && <>Sign in with email</>}
              </h1>
              <p className="sub">
                {mode === "signup" && "Sign up to save and manage your sites."}
                {mode === "signin" && "Enter your email and password to continue."}
                {mode === "magic" && "We'll email you a one-time sign-in link."}
              </p>

              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={authBusy}
                autoComplete="email"
              />

              {mode !== "magic" && (
                <input
                  className="input mt"
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={authBusy}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                />
              )}

              {mode === "signup" && (
                <input
                  className="input mt"
                  type="password"
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={authBusy}
                  autoComplete="new-password"
                />
              )}

              <button
                className="btn"
                disabled={authBusy || !email.trim()}
                onClick={
                  mode === "signup"
                    ? doSignup
                    : mode === "signin"
                    ? doLogin
                    : doMagicLink
                }
              >
                {authBusy
                  ? "Working…"
                  : mode === "signup"
                  ? "Create account"
                  : mode === "signin"
                  ? "Sign in"
                  : "Send sign-in link"}
              </button>

              {authErr && <p className="error">{authErr}</p>}

              <div className="auth-switch">
                {mode === "signin" && (
                  <>
                    <button className="link" onClick={() => { resetAuth(); setMode("signup"); }}>
                      Create an account
                    </button>
                    <span className="dot">·</span>
                    <button className="link" onClick={() => { resetAuth(); setMode("magic"); }}>
                      Email me a link
                    </button>
                  </>
                )}
                {mode === "signup" && (
                  <button className="link" onClick={() => { resetAuth(); setMode("signin"); }}>
                    Already have an account? Sign in
                  </button>
                )}
                {mode === "magic" && (
                  <button className="link" onClick={() => { resetAuth(); setMode("signin"); }}>
                    Use password instead
                  </button>
                )}
              </div>
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

  // ---------------- Main app ----------------
  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          Vothost<span>X</span>
        </div>
        <div className="header-right">
          <span className="user-email">{user.email}</span>
          <button className="btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main">
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

        <button className="btn" onClick={generate} disabled={loading || !prompt.trim()}>
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
.main.narrow{max-width:440px}
h1{font-size:36px;font-weight:700;letter-spacing:-1px;margin-bottom:12px}
h1 span{color:var(--accent)}
.sub{color:var(--muted);font-size:16px;margin-bottom:28px;line-height:1.6}
.input,.textarea{width:100%;padding:14px 16px;font-size:15px;font-family:inherit;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--text)}
.textarea{height:130px;resize:vertical}
.input.mt{margin-top:12px}
.input:focus,.textarea:focus{outline:none;border-color:var(--accent)}
.input:disabled,.textarea:disabled{opacity:.6}
.btn{margin-top:16px;padding:14px 28px;font-size:15px;font-weight:600;cursor:pointer;background:var(--accent);color:#000;border:none;border-radius:10px;width:auto}
.btn:hover:not(:disabled){opacity:.85}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn-ghost{margin-top:16px;background:transparent;color:var(--muted);border:1px solid var(--border);padding:10px 18px;border-radius:8px;cursor:pointer;font-size:13px}
.btn-ghost:hover{color:var(--text);border-color:var(--text)}
.link{background:none;border:none;color:var(--accent);cursor:pointer;font-size:14px;padding:0;font-weight:500}
.link:hover{text-decoration:underline}
.auth-switch{margin-top:20px;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dot{color:var(--muted)}
.status{color:var(--muted);font-size:14px;margin-top:20px}
.error{color:#f87171;font-size:14px;margin-top:16px}
.success{color:var(--accent);font-size:14px;margin-top:24px;margin-bottom:12px}
.loading{display:flex;align-items:center;justify-content:center;min-height:100vh;color:var(--muted)}
.preview{width:100%;height:560px;border:1px solid var(--border);border-radius:12px;background:#fff;margin-top:8px}
.meta{margin-top:20px;padding:20px;background:var(--panel);border:1px solid var(--border);border-radius:12px;font-size:14px;line-height:1.7}
.meta strong{color:var(--accent)}
.meta code{background:#000;padding:2px 8px;border-radius:4px;color:var(--accent);font-size:13px}
.footer{padding:24px;text-align:center;font-size:13px;color:var(--muted);border-top:1px solid var(--border)}
.footer strong{color:var(--text)}
`;
