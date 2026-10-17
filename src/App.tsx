import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://vothostx.domx28718.workers.dev";

type User = { id: string; email: string };
type Project = { id: string; name: string; prompt: string; created_at: number };
type FileMeta = { id: string; path: string; updated_at: number };
type FileFull = { id: string; project_id: string; path: string; content: string };

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

  useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

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
    fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" })
      .finally(() => {
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

  if (path === "/signup") {
    return (
      <AuthPage
        mode="signup"
        onSuccess={(u) => { setUser(u); navigate("/dashboard"); }}
        onSwitch={() => navigate("/login")}
      />
    );
  }

  if (path === "/login") {
    return (
      <AuthPage
        mode="login"
        onSuccess={(u) => { setUser(u); navigate("/dashboard"); }}
        onSwitch={() => navigate("/signup")}
      />
    );
  }

  if (path === "/dashboard") {
    if (!user) {
      navigate("/login");
      return null;
    }
    return (
      <Dashboard
        user={user}
        onLogout={logout}
        onOpen={(id) => navigate(`/project/${id}`)}
      />
    );
  }

  const pm = path.match(/^\/project\/([a-z0-9]+)$/i);
  if (pm) {
    if (!user) {
      navigate("/login");
      return null;
    }
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
        <div className="logo" style={{ cursor: "pointer" }} onClick={() => (window.location.href = "/")}>
          Vothost<span>X</span>
        </div>
        <div className="parent">Powered by Alphatekx</div>
      </header>

      <main className="main narrow">
        <h1>{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className="sub">
          {mode === "signup" ? "Sign up and start building websites instantly." : "Sign in to continue to your dashboard."}
        </p>

        <form onSubmit={submit}>
          <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} autoComplete="email" required />
          <input className="input mt" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
          {mode === "signup" && (
            <input className="input mt" type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} autoComplete="new-password" required />
          )}
          <button className="btn" type="submit" disabled={busy || !email.trim()}>
            {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        <div className="auth-switch">
          <button className="link" onClick={onSwitch}>
            {mode === "signup" ? "Already have an account? Sign in" : "Don't have an account? Create one"}
          </button>
        </div>
      </main>

      <footer className="footer">Powered by <strong>Alphatekx</strong></footer>
    </div>
  );
}

function Dashboard({ user, onLogout, onOpen }: { user: User; onLogout: () => void; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"ai" | "manual">("ai");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API_URL}/api/projects`, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setProjects(data.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createAI() {
    if (!prompt.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setPrompt("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function createManual() {
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this project?")) return;
    await fetch(`${API_URL}/api/projects/${id}`, { method: "DELETE", credentials: "include" });
    setProjects((p) => p.filter((x) => x.id !== id));
  }

  function copyLink(id: string, url: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
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
        <p className="sub">Create a project with AI, or start from scratch like GitHub.</p>

        <div className="create-tabs">
          <button className={tab === "ai" ? "tab active" : "tab"} onClick={() => setTab("ai")}>✦ AI Generate</button>
          <button className={tab === "manual" ? "tab active" : "tab"} onClick={() => setTab("manual")}>◆ Manual</button>
        </div>

        <div className="create-box">
          {tab === "ai" ? (
            <>
              <textarea className="textarea" placeholder="A landing page for a coffee shop with menu, hours, and location" value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={creating} />
              <button className="btn" onClick={createAI} disabled={creating || !prompt.trim()}>
                {creating ? "Generating…" : "Generate new project"}
              </button>
            </>
          ) : (
            <>
              <input className="input" placeholder="my-project" value={name} onChange={(e) => setName(e.target.value)} disabled={creating} />
              <button className="btn" onClick={createManual} disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create empty project"}
              </button>
            </>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {loading ? (
          <p className="status">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <p>No projects yet.</p>
            <p className="muted-note">Create one above.</p>
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map((p) => {
              const liveUrl = `${API_URL.replace(/\/$/, "")}/p/${p.id}`;
              return (
                <div key={p.id} className="project-card">
                  <div className="project-card-head">
                    <h3>{p.name}</h3>
                    <span className="project-date">{new Date(p.created_at * 1000).toLocaleDateString()}</span>
                  </div>

                  <p className="project-prompt">{p.prompt || "Empty project"}</p>

                  <div className="project-live-row">
                    <a className="project-live-link" href={liveUrl} target="_blank" rel="noreferrer">
                      {liveUrl.replace(/^https?:\/\//, "")}
                    </a>
                    <button className="copy-btn" onClick={() => copyLink(p.id, liveUrl)} title="Copy link">
                      {copiedId === p.id ? "✓" : "⧉"}
                    </button>
                  </div>

                  <div className="project-actions">
                    <button className="btn-small" onClick={() => onOpen(p.id)}>Open editor</button>
                    <button className="btn-ghost" onClick={() => remove(p.id)}>Delete</button>
                  </div>
                </div>
              );
            })}
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
  const [original, setOriginal] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAsk, setAiAsk] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [aiProposal, setAiProposal] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  const hasChanges = draft !== original;

  async function loadFiles() {
    try {
      const res = await fetch(`${API_URL}/api/files?projectId=${id}`, { credentials: "include" });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setFiles(data.files);
      if (data.files[0] && !activeId) setActiveId(data.files[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFiles(); }, [id]);

  useEffect(() => {
    if (!activeId) return;
    fetch(`${API_URL}/api/files/${activeId}`, { credentials: "include" })
      .then(safeJson)
      .then((d) => {
        setActiveFile(d.file);
        setDraft(d.file.content);
        setOriginal(d.file.content);
      })
      .catch(() => {});
  }, [activeId]);

  async function commit() {
    if (!activeFile || !hasChanges) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch(`${API_URL}/api/files/${activeFile.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: draft }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setOriginal(draft);
      setSaved(true);
      setPreviewKey((k) => k + 1);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setSaving(false);
    }
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
    if (activeId === fileId) { setActiveId(""); setActiveFile(null); setDraft(""); setOriginal(""); }
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
    setAiBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/ai/edit`, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ fileId: activeFile.id, instruction: aiAsk }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error);
      setAiProposal(data.content);
      setAiAsk("");
    } catch (e) { setError(e instanceof Error ? e.message : "AI failed"); } finally { setAiBusy(false); }
  }

  function acceptAi() {
    if (aiProposal === null) return;
    setDraft(aiProposal);
    setAiProposal(null);
  }

  function rejectAi() { setAiProposal(null); }

  const liveUrl = `${API_URL.replace(/\/$/, "")}/p/${id}`;

  return (
    <div className="app">
      <header className="header">
        <div className="logo" style={{ cursor: "pointer" }} onClick={onBack}>Vothost<span>X</span></div>
        <div className="header-right">
          <a className="btn-ghost" href={liveUrl} target="_blank" rel="noreferrer">Live site ↗</a>
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
          {loading ? (
            <div className="empty-editor">Loading…</div>
          ) : activeFile ? (
            <>
              <div className="editor-head">
                <div className="editor-file-info">
                  <span className="file-path">{activeFile.path}</span>
                  {hasChanges && <span className="changed-tag">● Unsaved changes</span>}
                  {saved && <span className="saved-tag">✓ Committed</span>}
                </div>
              </div>

              <textarea
                className="code-area code-area-large"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />

              <div className="ai-bar">
                <input
                  className="input"
                  placeholder="Ask AI to edit this file…"
                  value={aiAsk}
                  onChange={(e) => setAiAsk(e.target.value)}
                  disabled={aiBusy}
                  onKeyDown={(e) => e.key === "Enter" && aiEdit()}
                />
                <button className="btn-small" onClick={aiEdit} disabled={aiBusy || !aiAsk.trim()}>
                  {aiBusy ? "Thinking…" : "Ask AI"}
                </button>
              </div>

              <div className="commit-bar">
                <div className="commit-info">
                  <div className="commit-avatar">{activeFile.path[0].toUpperCase()}</div>
                  <div>
                    <span className="commit-branch">main</span>
                    <span className="commit-message">
                      {hasChanges ? `Update ${activeFile.path}` : `No changes to ${activeFile.path}`}
                    </span>
                  </div>
                </div>
                <button
                  className={`commit-btn ${hasChanges ? "active" : ""}`}
                  onClick={commit}
                  disabled={saving || !hasChanges}
                >
                  {saving ? "Committing…" : hasChanges ? "Commit changes" : "Nothing to commit"}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-editor">Select a file or create one</div>
          )}
          {error && <p className="error">{error}</p>}
        </main>

        <aside className="preview-side">
          <div className="sidebar-head">
            <span>Preview</span>
            <button className="btn-tiny" onClick={() => setPreviewKey((k) => k + 1)}>Reload</button>
          </div>
          {activeFile ? (
            <iframe key={`${liveUrl}-${previewKey}`} className="mini-preview" src={liveUrl} title="preview" />
          ) : (
            <div className="empty-preview">No preview</div>
          )}
        </aside>
      </div>

      {aiProposal !== null && (
        <div className="modal-overlay" onClick={rejectAi}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>AI proposed changes</h3>
              <p>Preview how the updated <strong>{activeFile?.path}</strong> will look.</p>
            </div>
            <div className="modal-preview">
              <iframe className="modal-iframe" srcDoc={aiProposal} sandbox="allow-scripts allow-forms allow-popups allow-modals" title="AI preview" />
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={rejectAi}>Discard</button>
              <button className="btn-green" onClick={acceptAi}>✓ Apply to editor</button>
            </div>
            <p className="modal-hint">
              After applying, click <strong>Commit changes</strong> to publish it to the live site.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
