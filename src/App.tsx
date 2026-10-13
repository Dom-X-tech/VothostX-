import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://vothostx.domx28718.workers.dev";

type User = { id: string; email: string };
type Project = { id: string; name: string; prompt: string; created_at: number };
type FileMeta = { id: string; path: string; updated_at: number };
type FileFull = { id: string; project_id: string; path: string; content: string };

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) throw new Error(`Empty response (${res.status})`);
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON response (${res.status})`); }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
      .then(safeJson).then((d) => setUser(d.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  function navigate(to: string) {
    window.history.pushState({}, "", to);
    setPath(to);
  }

  function logout() {
    fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" })
      .finally(() => { setUser(null); navigate("/"); });
  }

  if (loading) return <div className="app"><div className="loading">Loading…</div></div>;

  if (path === "/signup") return <AuthPage mode="signup" onSuccess={(u) => { setUser(u); navigate("/dashboard"); }} onSwitch={() => navigate("/login")} />;
  if (path === "/login") return <AuthPage mode="login" onSuccess={(u) => { setUser(u); navigate("/dashboard"); }} onSwitch={() => navigate("/signup")} />;
  if (path === "/dashboard") {
    if (!user) { navigate("/login"); return null; }
    return <Dashboard user={user} onLogout={logout} onOpen={(id) => navigate(`/project/${id}`)} />;
  }

  const pm = path.match(/^\/project\/([a-z0-9]+)$/i);
  if (pm) {
    if (!user) { navigate("/login"); return null; }
    return <ProjectEditor id={pm[1]} onBack={() => navigate("/dashboard")} />;
  }

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
          <p className="sub">VothostX turns a prompt into a complete, hosted website. Create files, edit them, and let AI help you build — all in one place.</p>
          <button className="cta" onClick={() => navigate(user ? "/dashboard" : "/signup")}>
            {user ? "Go to dashboard" : "Get started"}
          </button>
        </section>
        <section className="features">
          <div className="feature"><div className="feature-icon">✦</div><h3>AI-powered generation</h3><p>Turn a sentence into a fully working website in seconds.</p></div>
          <div className="feature"><div className="feature-icon">◆</div><h3>File editor</h3><p>Create, upload, and edit HTML, CSS, and JS files directly.</p></div>
          <div className="feature"><div className="feature-icon">▲</div><h3>Instant hosting</h3><p>Every project gets its own live URL, hosted on the edge.</p></div>
        </section>
      </main>
      <footer className="footer">Powered by <strong>Alphatekx</strong></footer>
    </div>
  );
}

function AuthPage({ mode, onSuccess, onSwitch }: { mode: "signup" | "login"; onSuccess: (u: User) => void; onSwitch: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "signup" && password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setBusy(true);
    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed");
      onSuccess(data.user);
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); } finally { setBusy(false); }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo" style={{ cursor: "pointer" }} onClick={() => window.location.href = "/"}>Vothost<span>X</span></div>
        <div className="parent">Powered by Alphatekx</div>
      </header>
      <main className="main narrow">
        <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className="sub">{mode === "signup" ? "Sign up and start building instantly." : "Sign in to continue."}</p>
        <form onSubmit={submit}>
          <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} required />
          <input className="input mt" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} required />
          {mode === "signup" && <input className="input mt" type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} required />}
          <button className="btn" type="submit" disabled={busy || !email.trim()}>{busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}</button>
        </form>
        {error && <p className="error">{error}</p>}
        <div className="auth-switch">
          <button className="link" onClick={onSwitch}>{mode === "signup" ? "Already have an account? Sign in" : "Create an account"}</button>
        </div>
      </main>
      <footer className="footer">Powered by <strong>Alphatekx</strong></footer>
    </div>
  );
}

function Dashboard({ user, onLogout, onOpen }: { user: User; onLogout: () => void; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await fetch(`${API_URL}/api/projects`, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setProjects(data.projects);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!prompt.trim()) return;
    setCreating(true); setError("");
    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setPrompt("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setCreating(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this project?")) return;
    await fetch(`${API_URL}/api/projects/${id}`, { method: "DELETE", credentials: "include" });
    setProjects((p) => p.filter((x) => x.id !== id));
  }

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
        <p className="sub">Create a project from a prompt. The AI writes it, you host it.</p>
        <div className="create-box">
          <textarea className="textarea" placeholder="A landing page for a coffee shop with menu, hours, and location" value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={creating} />
          <button className="btn" onClick={create} disabled={creating || !prompt.trim()}>{creating ? "Generating…" : "Generate new project"}</button>
        </div>
        {error && <p className="error">{error}</p>}
        {loading ? <p className="status">Loading…</p> : projects.length === 0 ? (
          <div className="empty-state"><p>No projects yet.</p><p className="muted-note">Create one above.</p></div>
        ) : (
          <div className="projects-grid">
            {projects.map((p) => (
              <div key={p.id} className="project-card">
                <div className="project-card-head">
                  <h3>{p.name}</h3>
                  <span className="project-date">{new Date(p.created_at * 1000).toLocaleDateString()}</span>
                </div>
                <p className="project-prompt">{p.prompt}</p>
                <div className="project-actions">
                  <button className="btn-small" onClick={() => onOpen(p.id)}>Open</button>
                  <button className="btn-ghost" onClick={() => remove(p.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <footer className="footer">Powered by <strong>Alphatekx</strong></footer>
    </div>
  );
}

function ProjectEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [activeFile, setActiveFile] = useState<FileFull | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAsk, setAiAsk] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  async function loadFiles() {
    try {
      const res = await fetch(`${API_URL}/api/files?projectId=${id}`, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setFiles(data.files);
      if (data.files[0] && !activeId) setActiveId(data.files[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setLoading(false); }
  }
  useEffect(() => { loadFiles(); }, [id]);

  useEffect(() => {
    if (!activeId) return;
    fetch(`${API_URL}/api/files/${activeId}`, { credentials: "include" })
      .then(safeJson).then((d) => { setActiveFile(d.file); setDraft(d.file.content); }).catch(() => {});
  }, [activeId]);

  async function save() {
    if (!activeFile) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch(`${API_URL}/api/files/${activeFile.id}`, {
        method: "PUT", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ content: draft }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); } finally { setSaving(false); }
  }

  async function createFile() {
    if (!newFileName.trim()) return;
    try {
      const res = await fetch(`${API_URL}/api/files`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ projectId: id, path: newFileName, content: "" }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setNewFileName(""); setShowNew(false);
      await loadFiles();
      setActiveId(data.file.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function deleteFile(fileId: string) {
    if (!confirm("Delete this file?")) return;
    await fetch(`${API_URL}/api/files/${fileId}`, { method: "DELETE", credentials: "include" });
    setFiles((f) => f.filter((x) => x.id !== fileId));
    if (activeId === fileId) { setActiveId(""); setActiveFile(null); setDraft(""); }
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadBusy(true);
    try {
      const text = await f.text();
      const res = await fetch(`${API_URL}/api/files`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ projectId: id, path: f.name, content: text }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      await loadFiles();
      setActiveId(data.file.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); } finally { setUploadBusy(false); }
  }

  async function aiEdit() {
    if (!activeFile || !aiAsk.trim()) return;
    setAiBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/api/ai/edit`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ fileId: activeFile.id, instruction: aiAsk }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setDraft(data.content);
      setAiAsk("");
    } catch (e) { setError(e instanceof Error ? e.message : "AI failed"); } finally { setAiBusy(false); }
  }

  const liveUrl = `${API_URL.replace(/\/$/, "")}/p/${id}/${activeFile?.path ?? "index.html"}`;

  return (
    <div className="app">
      <header className="header">
        <div className="logo" style={{ cursor: "pointer" }} onClick={onBack}>Vothost<span>X</span></div>
        <div className="header-right">
          <a className="btn-ghost" href={`${API_URL}/p/${id}`} target="_blank" rel="noreferrer">Live site ↗</a>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
        </div>
      </header>

      <div className="editor-layout">
        <aside className="file-sidebar">
          <div className="sidebar-head">
            <span>Files</span>
            <button className="btn-tiny" onClick={() => setShowNew((s) => !s)}>+</button>
          </div>

          {showNew && (
            <div className="new-file-box">
              <input className="input tiny" placeholder="styles.css" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} />
              <button className="btn-tiny" onClick={createFile}>Create</button>
            </div>
          )}

          <label className="btn-tiny block" style={{ cursor: "pointer" }}>
            {uploadBusy ? "Uploading…" : "Upload file"}
            <input type="file" hidden onChange={uploadFile} disabled={uploadBusy} />
          </label>

          <ul className="file-list">
            {files.map((f) => (
              <li key={f.id} className={f.id === activeId ? "active" : ""}>
                <button className="file-link" onClick={() => setActiveId(f.id)}>{f.path}</button>
                <button className="file-x" onClick={() => deleteFile(f.id)}>×</button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="editor-main">
          {activeFile ? (
            <>
              <div className="editor-head">
                <span className="file-path">{activeFile.path}</span>
                <div className="editor-actions">
                  {saved && <span className="saved-tag">Saved</span>}
                  <button className="btn-small" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                </div>
              </div>
              <textarea className="code-area" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
              <div className="ai-bar">
                <input className="input" placeholder="Ask AI to edit this file…" value={aiAsk} onChange={(e) => setAiAsk(e.target.value)} disabled={aiBusy} onKeyDown={(e) => e.key === "Enter" && aiEdit()} />
                <button className="btn-small" onClick={aiEdit} disabled={aiBusy || !aiAsk.trim()}>{aiBusy ? "Thinking…" : "Ask AI"}</button>
              </div>
            </>
          ) : (
            <div className="empty-editor">Select a file or create one</div>
          )}
          {error && <p className="error">{error}</p>}
        </main>

        <aside className="preview-side">
          <div className="sidebar-head"><span>Preview</span></div>
          {activeFile ? (
            <iframe className="mini-preview" src={liveUrl} title="preview" />
          ) : (
            <div className="empty-preview">No preview</div>
          )}
        </aside>
      </div>
    </div>
  );
}
