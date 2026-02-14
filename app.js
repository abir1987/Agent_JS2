/* app.js */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // crash-safe loader
  const loaderError = (msg) => {
    const loading = $("loading");
    if (!loading) return;
    loading.innerHTML = `
      <div class="min-h-screen flex items-center justify-center px-6">
        <div class="max-w-xl w-full text-center">
          <div class="text-lg font-semibold text-red-600">App failed to load</div>
          <div class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">${String(msg || "Unknown error")}</div>
          <div class="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Tip: open DevTools → Console. Try adding ?v=123 to bypass cache.</div>
        </div>
      </div>`;
  };

  window.addEventListener("error", (e) => loaderError("Runtime error: " + (e?.message || e)));
  window.addEventListener("unhandledrejection", (e) => loaderError("Promise rejection: " + (e?.reason?.message || e?.reason || "unknown")));

  const LS = {
    key: "pas.or.key",
    model: "pas.or.model",
    dark: "pas.ui.dark",
    sys: "pas.sys.global",
    chats: "pas.chats",
    activeChat: "pas.chats.active",
    projects: "pas.projects",
    activeProject: "pas.projects.active",
    micLang: "pas.audio.lang",
    autoTTS: "pas.audio.autotts",
  };

  const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
  const DEFAULT_MODEL = "deepseek/deepseek-r1:free";

  const lsGet = (k, fb = "") => { try { const v = localStorage.getItem(k); return v == null ? fb : v; } catch { return fb; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const jGet = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  const jSet = (k, o) => { try { localStorage.setItem(k, JSON.stringify(o)); } catch {} };

  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const now = () => Date.now();

  const S = {
    apiKey: "",
    model: DEFAULT_MODEL,
    dark: false,
    system: "You are an advanced agent. Output complete working code. For projects, output multiple files using ```file path``` blocks.",
    micLang: "bn-BD",
    autoTTS: false,

    chats: [],
    activeChatId: null,

    projects: [],
    activeProjectId: null,

    attachments: [],
    streaming: false,
    abort: null,

    recognition: null,
    listening: false,

    editingPath: null,
    editorMode: "editor",
  };

  const applyDark = (on) => {
    S.dark = !!on;
    document.documentElement.classList.toggle("dark", S.dark);
    lsSet(LS.dark, S.dark ? "1" : "0");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", S.dark ? "#09090b" : "#ffffff");
  };

  const setStatus = (msg, err = false) => {
    const el = $("status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mt-2 text-xs " + (err ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400");
  };

  const sanitize = (html) => String(html || "").replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  const md = (txt) => {
    try {
      if (window.marked) return sanitize(window.marked.parse(String(txt || "")));
    } catch {}
    return "<p>" + String(txt || "").replace(/</g, "&lt;") + "</p>";
  };

  const ensureChat = () => {
    let c = S.chats.find(x => x.id === S.activeChatId) || null;
    if (c) return c;
    if (S.chats.length) { S.activeChatId = S.chats[0].id; return S.chats[0]; }
    const n = { id: uid(), title: "New chat", updatedAt: now(), messages: [] };
    S.chats.unshift(n); S.activeChatId = n.id; return n;
  };

  const saveChats = () => {
    jSet(LS.chats, S.chats);
    lsSet(LS.activeChat, S.activeChatId || "");
  };

  const addMsg = (role, content) => {
    const c = ensureChat();
    c.messages.push({ role, content: String(content || "") });
    c.updatedAt = now();
    if (c.title === "New chat" && role === "user") {
      const t = String(content || "").trim().slice(0, 36);
      if (t) c.title = t;
    }
    saveChats();
  };

  const ensureProject = () => {
    let p = S.projects.find(x => x.id === S.activeProjectId) || null;
    if (p) return p;
    if (S.projects.length) { S.activeProjectId = S.projects[0].id; return S.projects[0]; }
    const np = {
      id: uid(),
      name: "My Project",
      updatedAt: now(),
      files: {
        "index.html": { type: "text/html", content: "<!doctype html>\n<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>New Project</title></head><body><h1>Hello</h1></body></html>" }
      }
    };
    S.projects.unshift(np); S.activeProjectId = np.id; return np;
  };

  const saveProjects = () => {
    jSet(LS.projects, S.projects);
    lsSet(LS.activeProject, S.activeProjectId || "");
  };

  const updateHeader = () => {
    const c = ensureChat();
    $("chatTitle").textContent = c.title || "New chat";
    $("modelLabel").textContent = S.model || DEFAULT_MODEL;
  };

  const updateProjectHeader = () => {
    const p = ensureProject();
    $("projectLabel").textContent = p.name || "Project";
  };

  const renderChats = () => {
    const box = $("listChats");
    const q = ($("search")?.value || "").toLowerCase().trim();
    box.innerHTML = "";
    let items = S.chats.slice().sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0));
    if (q) items = items.filter(c => (c.title||"").toLowerCase().includes(q));
    if (!items.length) {
      box.innerHTML = `<div class="p-4 text-sm text-zinc-500 dark:text-zinc-400">No chats.</div>`;
      return;
    }
    items.forEach(c => {
      const active = c.id === S.activeChatId;
      const row = document.createElement("div");
      row.className = "group px-2 py-2 rounded-2xl cursor-pointer flex items-center gap-2 " + (active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800");
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold truncate">${c.title || "Untitled"}</div>
          <div class="text-xs text-zinc-500 dark:text-zinc-400">${(c.messages||[]).length} msgs</div>
        </div>
        <div class="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
          <button class="rename p-2 rounded-xl hover:bg-white dark:hover:bg-zinc-900" title="Rename">✎</button>
          <button class="del p-2 rounded-xl hover:bg-white dark:hover:bg-zinc-900" title="Delete">🗑</button>
        </div>`;
      row.querySelector(".rename").onclick = (e) => {
        e.stopPropagation();
        const t = prompt("Rename chat:", c.title || "");
        if (t == null) return;
        c.title = (t.trim().slice(0,80) || "Untitled");
        c.updatedAt = now();
        saveChats(); renderChats(); updateHeader();
      };
      row.querySelector(".del").onclick = (e) => {
        e.stopPropagation();
        if (!confirm(`Delete chat "${c.title||"Chat"}"?`)) return;
        S.chats = S.chats.filter(x => x.id !== c.id);
        if (S.activeChatId === c.id) S.activeChatId = null;
        ensureChat();
        saveChats(); renderChats(); renderMessages(); updateHeader();
      };
      row.onclick = () => {
        S.activeChatId = c.id; saveChats();
        renderChats(); renderMessages(); updateHeader();
        closeSidebar();
      };
      box.appendChild(row);
    });
  };

  const renderProjects = () => {
    const box = $("listProjects");
    const q = ($("search")?.value || "").toLowerCase().trim();
    box.innerHTML = "";
    let items = S.projects.slice().sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0));
    if (q) items = items.filter(p => (p.name||"").toLowerCase().includes(q));
    if (!items.length) {
      box.innerHTML = `<div class="p-4 text-sm text-zinc-500 dark:text-zinc-400">No projects.</div>`;
      return;
    }
    items.forEach(p => {
      const active = p.id === S.activeProjectId;
      const count = Object.keys(p.files||{}).length;
      const row = document.createElement("div");
      row.className = "group px-2 py-2 rounded-2xl cursor-pointer flex items-center gap-2 " + (active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800");
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold truncate">${p.name || "Project"}</div>
          <div class="text-xs text-zinc-500 dark:text-zinc-400">${count} files</div>
        </div>
        <div class="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
          <button class="rename p-2 rounded-xl hover:bg-white dark:hover:bg-zinc-900" title="Rename">✎</button>
          <button class="del p-2 rounded-xl hover:bg-white dark:hover:bg-zinc-900" title="Delete">🗑</button>
        </div>`;
      row.querySelector(".rename").onclick = (e) => {
        e.stopPropagation();
        const t = prompt("Rename project:", p.name || "");
        if (t == null) return;
        p.name = (t.trim().slice(0,80) || "Project");
        p.updatedAt = now();
        saveProjects(); renderProjects(); updateProjectHeader();
      };
      row.querySelector(".del").onclick = (e) => {
        e.stopPropagation();
        if (!confirm(`Delete project "${p.name||"Project"}"?`)) return;
        S.projects = S.projects.filter(x => x.id !== p.id);
        if (S.activeProjectId === p.id) S.activeProjectId = null;
        ensureProject();
        saveProjects(); renderProjects(); renderFileTree(); updateProjectHeader(); refreshPreview();
      };
      row.onclick = () => {
        S.activeProjectId = p.id; saveProjects();
        renderProjects(); updateProjectHeader(); renderFileTree();
        openWorkspaceIfNeeded(); refreshPreview(); closeSidebar();
      };
      box.appendChild(row);
    });
  };

  const renderMessages = () => {
    const c = ensureChat();
    const box = $("messages");
    box.innerHTML = "";
    if (!c.messages.length) { box.appendChild($("empty")); return; }
    c.messages.forEach(m => {
      const isUser = m.role === "user";
      const wrap = document.createElement("div");
      wrap.className = "w-full flex " + (isUser ? "justify-end" : "justify-start");
      const bubble = document.createElement("div");
      bubble.className =
        "max-w-[92%] md:max-w-[75%] rounded-2xl px-4 py-3 border text-sm leading-6 " +
        (isUser
          ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
          : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800");
      const content = document.createElement("div");
      content.className = "prose prose-zinc dark:prose-invert max-w-none prose-pre:rounded-xl prose-pre:border prose-pre:border-zinc-200 dark:prose-pre:border-zinc-800";
      content.innerHTML = md(m.content);
      bubble.appendChild(content);
      wrap.appendChild(bubble);
      box.appendChild(wrap);

      try { bubble.querySelectorAll("pre code").forEach(b => window.hljs && hljs.highlightElement(b)); } catch {}
    });
    box.scrollTop = box.scrollHeight;
  };

  const openSidebar = () => { $("sidebar").classList.remove("-translate-x-full"); $("overlay").classList.remove("hidden"); };
  const closeSidebar = () => { if (matchMedia("(min-width:768px)").matches) return; $("sidebar").classList.add("-translate-x-full"); $("overlay").classList.add("hidden"); };

  const autosize = () => {
    const ta = $("input");
    ta.style.height = "auto";
    ta.style.height = Math.min(160, ta.scrollHeight) + "px";
  };

  // Attachments
  const renderAttachments = () => {
    const tray = $("attachTray"), list = $("attachList");
    if (!S.attachments.length) { tray.classList.add("hidden"); list.innerHTML=""; return; }
    tray.classList.remove("hidden");
    list.innerHTML = "";
    S.attachments.forEach((a, i) => {
      const chip = document.createElement("div");
      chip.className = "flex items-center gap-2 px-2 py-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950";
      chip.innerHTML = `<div class="text-xs font-semibold truncate max-w-[220px]">${a.name}</div>`;
      const rm = document.createElement("button");
      rm.className = "px-2 py-1 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs";
      rm.textContent = "✕";
      rm.onclick = () => { S.attachments.splice(i,1); renderAttachments(); };
      chip.appendChild(rm);
      list.appendChild(chip);
    });
  };

  const readAsText = (file, limit=120000) => new Promise((resolve,reject) => {
    const r = new FileReader();
    r.onload = () => {
      let t = String(r.result || "");
      if (t.length > limit) t = t.slice(0, limit) + "\n\n[TRUNCATED]";
      resolve(t);
    };
    r.onerror = () => reject(new Error("read failed"));
    r.readAsText(file);
  });

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    for (const f of files) {
      const a = { name: f.name, type: f.type || "application/octet-stream", size: f.size||0, text: "" };
      if (!a.type.startsWith("image/")) {
        try { a.text = await readAsText(f); } catch {}
      } else {
        // Image: we just keep name (vision models need extra support; next update)
      }
      S.attachments.push(a);
    }
    renderAttachments();
    setStatus(`Attached ${files.length} file(s).`);
  };

  // Projects: file tree/editor/preview (simple srcdoc)
  const renderFileTree = () => {
    const box = $("fileTree");
    const p = ensureProject();
    box.innerHTML = "";
    const paths = Object.keys(p.files||{}).sort();
    if (!paths.length) { box.innerHTML = `<div class="p-2 text-xs text-zinc-500">No files.</div>`; return; }
    paths.forEach(path => {
      const active = path === S.editingPath;
      const row = document.createElement("div");
      row.className = "px-2 py-2 rounded-xl cursor-pointer flex items-center justify-between gap-2 " + (active ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800");
      row.innerHTML = `<div class="text-xs font-semibold truncate mono">${path}</div>`;
      row.onclick = () => openFile(path);
      box.appendChild(row);
    });
  };

  const openFile = (path) => {
    const p = ensureProject();
    if (!p.files[path]) return;
    S.editingPath = path;
    $("editingPath").textContent = path;
    $("editor").value = p.files[path].content || "";
    renderFileTree();
  };

  const saveFile = () => {
    const p = ensureProject();
    if (!S.editingPath) return setStatus("No file selected.", true);
    p.files[S.editingPath].content = $("editor").value || "";
    p.updatedAt = now();
    saveProjects();
    setStatus("Saved: " + S.editingPath);
    refreshPreview();
    renderProjects();
  };

  const buildPreviewHTML = () => {
    const p = ensureProject();
    return p.files["index.html"] ? p.files["index.html"].content : "<h2>No index.html</h2>";
  };

  const refreshPreview = () => {
    const html = buildPreviewHTML();
    $("preview").srcdoc = html;
  };

  const openWorkspaceIfNeeded = () => {
    if (matchMedia("(min-width:768px)").matches) {
      $("rightPanel").classList.remove("hidden");
      $("splitHandle").classList.remove("hidden");
    }
  };

  // Streaming OpenRouter
  const setStreaming = (on) => {
    S.streaming = !!on;
    $("send").disabled = S.streaming;
    $("stopBtn").classList.toggle("hidden", !S.streaming);
    $("input").disabled = S.streaming;
  };

  const buildMessages = () => {
    const c = ensureChat();
    const msgs = [];
    const sys = (S.system || "").trim();
    if (sys) msgs.push({ role: "system", content: sys });
    (c.messages||[]).forEach(m => msgs.push({ role: m.role, content: m.content }));
    return msgs;
  };

  const streamOnce = async () => {
    const key = (S.apiKey || "").trim();
    if (!key) { setStatus("Add API key in Settings (⚙).", true); $("settings").classList.remove("hidden"); return; }

    addMsg("assistant", "");
    renderMessages();
    saveChats();

    setStreaming(true);
    setStatus("Streaming...");

    S.abort = new AbortController();
    let full = "";

    try {
      const res = await fetch(OPENROUTER, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + key,
          "HTTP-Referer": location.origin || "http://localhost",
          "X-Title": "Pro Agent Studio"
        },
        body: JSON.stringify({ model: S.model || DEFAULT_MODEL, messages: buildMessages(), stream: true }),
        signal: S.abort.signal
      });

      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new Error("OpenRouter error " + res.status + ": " + (t || res.statusText));
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder("utf-8");
      let buf = "";

      while (true) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") break;
          let j; try { j = JSON.parse(data); } catch { continue; }
          const delta = j?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            full += delta;
            const c = ensureChat();
            for (let i = c.messages.length - 1; i >= 0; i--) {
              if (c.messages[i].role === "assistant") { c.messages[i].content = full; break; }
            }
            saveChats();
            renderMessages();
          }
        }
      }

      setStatus("Done.");
    } catch (e) {
      setStatus(e?.message || "Unknown error", true);
    } finally {
      setStreaming(false);
      S.abort = null;
    }
  };

  const sendMessage = () => {
    if (S.streaming) return;
    const raw = ($("input").value || "").trim();
    if (!raw && !S.attachments.length) return;

    // include attachment texts in user message (safe)
    let content = raw;
    if (S.attachments.length) {
      content += "\n\n---\nAttachments:\n";
      for (const a of S.attachments) {
        content += `- ${a.name}\n`;
        if (a.text) content += "```text\n" + a.text + "\n```\n";
      }
    }

    addMsg("user", content);
    $("input").value = "";
    autosize();
    renderChats();
    updateHeader();
    renderMessages();

    streamOnce();
  };

  // Audio (basic) - Mic to text best in Chrome
  const isSR = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const setMicHint = () => {
    $("micHint").textContent = "Mic: " + (isSR() ? (S.listening ? "listening..." : "ready") : "unsupported");
  };
  const startMic = () => {
    if (!isSR()) return setStatus("SpeechRecognition not supported. Use Chrome.", true);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!S.recognition) {
      const rec = new SR();
      rec.interimResults = true;
      rec.continuous = false;
      rec.onstart = () => { S.listening = true; setMicHint(); setStatus("Listening..."); };
      rec.onend = () => { S.listening = false; setMicHint(); };
      rec.onerror = (e) => { S.listening = false; setMicHint(); setStatus("Mic error: " + (e?.error || "unknown"), true); };
      rec.onresult = (ev) => {
        let finalText = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) finalText += (ev.results[i][0].transcript || "") + " ";
        }
        finalText = finalText.trim();
        if (finalText) { $("input").value = ($("input").value ? $("input").value + " " : "") + finalText; autosize(); }
      };
      S.recognition = rec;
    }
    S.recognition.lang = S.micLang || "bn-BD";
    try { S.recognition.start(); } catch {}
  };
  const stopMic = () => { try { S.recognition?.stop(); } catch {} S.listening = false; setMicHint(); };

  const speakText = (text) => {
    if (!("speechSynthesis" in window)) return setStatus("TTS not supported.", true);
    try { speechSynthesis.cancel(); } catch {}
    const clean = String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = S.micLang || "bn-BD";
    try { speechSynthesis.speak(u); } catch {}
  };

  // Tabs
  const setTab = (tab) => {
    if (tab === "projects") {
      $("tabProjects").className = "flex-1 px-3 py-2 rounded-2xl text-sm font-semibold bg-zinc-100 dark:bg-zinc-800";
      $("tabChats").className = "flex-1 px-3 py-2 rounded-2xl text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800";
      $("listProjects").classList.remove("hidden");
      $("listChats").classList.add("hidden");
    } else {
      $("tabChats").className = "flex-1 px-3 py-2 rounded-2xl text-sm font-semibold bg-zinc-100 dark:bg-zinc-800";
      $("tabProjects").className = "flex-1 px-3 py-2 rounded-2xl text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800";
      $("listChats").classList.remove("hidden");
      $("listProjects").classList.add("hidden");
    }
  };

  // ZIP export
  const exportProjectZip = async () => {
    if (!window.JSZip) return setStatus("JSZip not loaded.", true);
    const p = ensureProject();
    const zip = new JSZip();
    const files = p.files || {};
    Object.keys(files).forEach(path => zip.file(path, files[path].content || ""));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (p.name || "project").replace(/[^\w\-]+/g, "_") + ".zip";
    document.body.appendChild(a);
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const showEditor = () => { $("editor").classList.remove("hidden"); $("preview").classList.add("hidden"); };
  const showPreview = () => { $("editor").classList.add("hidden"); $("preview").classList.remove("hidden"); refreshPreview(); };

  // Boot
  const init = () => {
    S.apiKey = lsGet(LS.key, "");
    S.model = lsGet(LS.model, DEFAULT_MODEL) || DEFAULT_MODEL;
    S.dark = lsGet(LS.dark, "0") === "1";
    S.system = lsGet(LS.sys, S.system) || S.system;
    S.micLang = lsGet(LS.micLang, "bn-BD") || "bn-BD";
    S.autoTTS = lsGet(LS.autoTTS, "0") === "1";

    S.chats = jGet(LS.chats, []);
    if (!Array.isArray(S.chats)) S.chats = [];
    S.activeChatId = lsGet(LS.activeChat, "") || null;

    S.projects = jGet(LS.projects, []);
    if (!Array.isArray(S.projects)) S.projects = [];
    S.activeProjectId = lsGet(LS.activeProject, "") || null;

    applyDark(S.dark);
    ensureChat();
    ensureProject();

    updateHeader();
    updateProjectHeader();
    renderChats();
    renderProjects();
    renderMessages();
    renderFileTree();
    openFile("index.html");
    refreshPreview();
    setMicHint();
    $("ttsHint").textContent = "TTS: " + (S.autoTTS ? "on" : "off");

    $("loading").style.display = "none";
    $("app").style.display = "flex";
    setStatus(S.apiKey ? "Ready." : "Add API key in Settings (⚙).");
  };

  const bind = () => {
    $("openSidebar").onclick = openSidebar;
    $("closeSidebar").onclick = closeSidebar;
    $("overlay").onclick = closeSidebar;

    $("tabChats").onclick = () => setTab("chats");
    $("tabProjects").onclick = () => setTab("projects");

    $("search").oninput = () => { renderChats(); renderProjects(); };

    $("newChat").onclick = () => {
      const c = { id: uid(), title: "New chat", updatedAt: now(), messages: [] };
      S.chats.unshift(c);
      S.activeChatId = c.id;
      saveChats();
      renderChats(); updateHeader(); renderMessages();
      closeSidebar();
    };

    $("settingsBtn").onclick = () => {
      $("apiKey").value = S.apiKey || "";
      $("model").value = S.model || DEFAULT_MODEL;
      $("micLang").value = S.micLang || "bn-BD";
      $("autoTTS").checked = !!S.autoTTS;
      $("settings").classList.remove("hidden");
    };

    document.body.addEventListener("click", (e) => {
      const close = e.target?.getAttribute?.("data-close");
      if (close) $(close)?.classList.add("hidden");
    });

    $("saveSettings").onclick = () => {
      S.apiKey = ($("apiKey").value || "").trim();
      S.model = ($("model").value || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      S.micLang = $("micLang").value || "bn-BD";
      S.autoTTS = !!$("autoTTS").checked;

      lsSet(LS.key, S.apiKey);
      lsSet(LS.model, S.model);
      lsSet(LS.micLang, S.micLang);
      lsSet(LS.autoTTS, S.autoTTS ? "1" : "0");

      $("settings").classList.add("hidden");
      updateHeader();
      $("ttsHint").textContent = "TTS: " + (S.autoTTS ? "on" : "off");
      setMicHint();
      setStatus("Settings saved.");
    };

    $("darkBtn").onclick = () => applyDark(!S.dark);

    $("systemBtn").onclick = () => {
      $("systemText").value = S.system || "";
      $("system").classList.remove("hidden");
    };
    $("saveSystem").onclick = () => {
      S.system = $("systemText").value || "";
      lsSet(LS.sys, S.system);
      $("system").classList.add("hidden");
      setStatus("System saved.");
    };

    $("builderBtn").onclick = () => $("builder").classList.remove("hidden");

    $("clearChat").onclick = () => {
      const c = ensureChat();
      if (!confirm("Clear this chat?")) return;
      c.messages = [];
      c.updatedAt = now();
      saveChats();
      renderMessages();
      renderChats();
    };

    $("input").addEventListener("input", autosize);
    $("input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    $("send").onclick = sendMessage;

    $("stopBtn").onclick = () => {
      try { S.abort?.abort(); } catch {}
      setStreaming(false);
      setStatus("Stopped.");
    };

    $("attachBtn").onclick = () => $("fileInput").click();
    $("fileInput").onchange = async () => {
      const fi = $("fileInput");
      if (fi.files?.length) await addFiles(fi.files);
      fi.value = "";
    };
    $("clearAttach").onclick = () => { S.attachments = []; renderAttachments(); setStatus("Attachments cleared."); };
    $("addToProject").onclick = () => setStatus("This step can be expanded next. (Attachment → project uploads)");

    // Drag drop
    window.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dropGlow"); });
    window.addEventListener("dragleave", (e) => { if (e.relatedTarget === null) document.body.classList.remove("dropGlow"); });
    window.addEventListener("drop", async (e) => {
      e.preventDefault(); document.body.classList.remove("dropGlow");
      if (e.dataTransfer?.files?.length) await addFiles(e.dataTransfer.files);
    });

    $("micBtn").onclick = () => (S.listening ? stopMic() : startMic());

    $("ttsBtn").onclick = () => {
      S.autoTTS = !S.autoTTS;
      lsSet(LS.autoTTS, S.autoTTS ? "1" : "0");
      $("ttsHint").textContent = "TTS: " + (S.autoTTS ? "on" : "off");
      setStatus("TTS " + (S.autoTTS ? "enabled" : "disabled"));
    };

    $("togglePreview").onclick = () => {
      if (matchMedia("(min-width:768px)").matches) {
        $("rightPanel").classList.toggle("hidden");
        $("splitHandle").classList.toggle("hidden");
        if (!$("rightPanel").classList.contains("hidden")) { openWorkspaceIfNeeded(); refreshPreview(); }
      } else {
        alert("On mobile: preview panel is desktop-first in this version. (Next: mobile overlay preview)");
      }
    };

    $("newProject").onclick = () => {
      const name = prompt("Project name:", "My Project");
      if (name == null) return;
      const p = { id: uid(), name: name.trim() || "My Project", updatedAt: now(), files: { "index.html": { type:"text/html", content: "<!doctype html>\n<html><body><h1>Hello</h1></body></html>" } } };
      S.projects.unshift(p);
      S.activeProjectId = p.id;
      saveProjects();
      renderProjects(); updateProjectHeader(); renderFileTree();
      openFile("index.html"); refreshPreview(); openWorkspaceIfNeeded();
    };

    $("addFile").onclick = () => {
      const p = ensureProject();
      const path = prompt("New file path:", "style.css");
      if (path == null) return;
      const t = path.trim();
      if (!t) return;
      if (p.files[t]) return alert("File exists.");
      p.files[t] = { type: "text/plain", content: "" };
      p.updatedAt = now();
      saveProjects();
      renderFileTree();
      openFile(t);
      renderProjects();
    };

    $("saveFile").onclick = saveFile;
    $("reloadPreview").onclick = refreshPreview;

    $("downloadFile").onclick = () => {
      const p = ensureProject();
      if (!S.editingPath) return setStatus("No file selected.", true);
      const content = p.files[S.editingPath].content || "";
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = S.editingPath.split("/").pop() || "file.txt";
      document.body.appendChild(a);
      a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    $("toggleEditor").onclick = showEditor;
    $("toggleLive").onclick = showPreview;

    $("exportZip").onclick = exportProjectZip;
    $("publishHelp").onclick = () => alert("Publish: ZIP Download → Unzip → Upload to GitHub repo root → Settings → Pages → Deploy from branch.");

    window.addEventListener("resize", () => {
      if (matchMedia("(min-width:768px)").matches) {
        $("overlay").classList.add("hidden");
        $("sidebar").classList.remove("-translate-x-full");
      } else {
        $("sidebar").classList.add("-translate-x-full");
        $("overlay").classList.add("hidden");
      }
    });
  };

  // Start
  try { init(); bind(); } catch (e) { loaderError("Init error: " + (e?.message || e)); }
})();
