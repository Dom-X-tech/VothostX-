import { useEffect, useState } from "react";

const API_URL =
  import.meta.env.VITE_API_URL || "https://vothostx.domx28718.workers.dev";

type User = { id: string; email: string };

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) throw new Error(`Empty response (${res.status})`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status})`);
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);

  // Popstate navigation
  useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  // Check session on load
  useEffect(() => {
    fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
      .then(safeJson)
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  function navigate(to: string) {
    window.history.pushState({}, "", to);
    setPath(to);
  }

  function logout() {
    fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).finally(() => {
      setUser(null);
      navigate("/");
    });
  }

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading…</div>
      </div>
    );
  }

  // ---------- ROUTING ----------
  if (path === "/signup") {
    return <AuthPage mode="signup" onSuccess={(u) => { setUser(u); navigate("/dashboard"); }} onSwitch={() => navigate("/login")} />;
  }
  if (path === "/login") {
    return <AuthPage mode="login" onSuccess={(u) => { setUser(u); navigate("/dashboard"); }} onSwitch={() => navigate("/signup")} />;
  }
  if (path === "/dashboard") {
    if (!user) {
      navigate("/login");
      return null;
    }
    return <Dashboard user={user} onLogout={logout} />;
  }

  // ---------- LANDING ----------
  return (
    <div className="app">
      <header className="header">
        <div className="logo">Vothost<span>X</span></div>
        <div className="header-right">
          {user ? (
            <>
              <span className="user-email">{user.email}</span>
              <button className="btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
              <button className="btn-ghost" onClick={logout}>Sign out</button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={() => navigate("/login")}>Sign in</button>
              <button className="btn-small" onClick={() => navigate("/signup")}>Get started</button>
            </>
          )}
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <h1>Describe it.<br /><span>We build &amp; host it.</span></h1>
          <p className="sub">
            VothostX turns a prompt into a complete, hosted website. Create files, edit them, and let AI help you build — all in one place.
          </p>
          <button className="cta" onClick={() => navigate(user ? "/dashboard" : "/signup")}>
            {user ? "Go to dashboard" : "Get started"}
          </button>
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
      </main>

      <footer className="footer">
        Powered by <strong>Alphatekx</strong>
      </footer>
    </div>
  );
}

// ============================================================
// AUTH PAGE
// ============================================================

function AuthPage({
  mode,
  onSuccess,
  onSwitch,
}: {
  mode: "signup" | "login";
  onSuccess: (u: User) => void;
  onSwitch: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (mode === "signup" && password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setBusy(true);
    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed");
      onSuccess(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo" style={{ cursor: "pointer" }} onClick={() => window.location.href = "/"}>
          Vothost<span>X</span>
        </div>
        <div className="parent">Powered by Alphatekx</div>
      </header>

      <main className="main narrow">
        <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className="sub">
          {mode === "signup"
            ? "Sign up and start building websites instantly."
            : "Sign in to continue to your dashboard."}
        </p>

        <form onSubmit={submit}>
          <input
            className="input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            autoComplete="email"
            required
          />
          <input
            className="input mt"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
          />
          {mode === "signup" && (
            <input
              className="input mt"
              type="password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              autoComplete="new-password"
              required
            />
          )}

          <button className="btn" type="submit" disabled={busy || !email.trim()}>
            {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        <div className="auth-switch">
          {mode === "signup" ? (
            <button className="link" onClick={onSwitch}>
              Already have an account? Sign in
            </button>
          ) : (
            <button className="link" onClick={onSwitch}>
              Don't have an account? Create one
            </button>
          )}
        </div>
      </main>

      <footer className="footer">
        Powered by <strong>Alphatekx</strong>
      </footer>
    </div>
  );
}

// ============================================================
// DASHBOARD
// ============================================================

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div className="app">
      <header className="header">
        <div className="logo">Vothost<span>X</span></div>
        <div className="header-right">
          <span className="user-email">{user.email}</span>
          <button className="btn-ghost" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <main className="main">
        <h1>Your dashboard</h1>
        <p className="sub">Welcome, {user.email}.</p>

        <div className="empty-state">
          <p>You don't have any projects yet.</p>
          <p className="muted-note">Project creation coming in the next step.</p>
        </div>
      </main>

      <footer className="footer">
        Powered by <strong>Alphatekx</strong>
      </footer>
    </div>
  );
}
