"use client";
import { useState, useEffect } from "react";
import { PDFDocument } from "pdf-lib";
import { supabase } from "./lib/supabase";

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const L = "ABCDEFGH";
const mg = (a, b, k) => [...a, ...b.filter((x) => !a.some((y) => y[k] === x[k]))];

export default function Page() {
  const [view, setView] = useState("home");
  const [sets, setSets] = useState([]);
  const [atts, setAtts] = useState([]);
  const [cur, setCur] = useState(null);
  const [cfg, setCfg] = useState({ count: 20, shuf: true, min: 0 });
  const [qs, setQs] = useState([]);
  const [ans, setAns] = useState([]);
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(0);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [marks, setMarks] = useState([]);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { setSets(load("sets", [])); setAtts(load("atts", [])); setMarks(load("marks", [])); }, []);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!user) { setReady(false); return; }
    (async () => {
      const { data } = await supabase.from("user_data").select("data").eq("user_id", user.id).maybeSingle();
      const d = data?.data || {};
      const s2 = mg(d.sets || [], load("sets", []), "id"), a2 = mg(d.atts || [], load("atts", []), "id"), m2 = mg(d.marks || [], load("marks", []), "q");
      setSets(s2); setAtts(a2); setMarks(m2); save("sets", s2); save("atts", a2); save("marks", m2);
      setReady(true);
    })();
  }, [user]);
  useEffect(() => {
    if (!user || !ready) return;
    const t = setTimeout(() => supabase.from("user_data").upsert({ user_id: user.id, data: { sets, atts, marks }, updated_at: new Date().toISOString() }), 1000);
    return () => clearTimeout(t);
  }, [sets, atts, marks, user, ready]);
  useEffect(() => {
    if (view !== "test" || !cfg.min) return;
    const t = setInterval(() => setLeft((x) => x - 1), 1000);
    return () => clearInterval(t);
  }, [view, cfg.min]);
  useEffect(() => { if (view === "test" && cfg.min && left <= 0) finish(); }, [left]);

  async function parseOne(blob, name) {
    const fd = new FormData(); fd.append("file", blob, name);
    const r = await fetch("/api/parse", { method: "POST", body: fd });
    const t = await r.text();
    let d;
    try { d = JSON.parse(t); } catch {
      throw new Error(r.status === 413 ? "This PDF is too large for the server. Try a smaller or compressed PDF." : r.status === 504 || /timed? ?out/i.test(t) ? "The server timed out. Try a PDF with fewer pages." : "Server error (" + r.status + "): " + t.slice(0, 80));
    }
    if (!r.ok) throw new Error(d.error || "Error");
    return d.questions;
  }

  async function upload(file) {
    if (!file) return;
    setErr(""); setBusy("Extracting MCQs…");
    try {
      let all = [];
      if (file.size <= 3.5 * 1024 * 1024) {
        all = await parseOne(file, file.name);
      } else {
        // Large PDF: 10-page chunks, each with the last 3 pages appended (answer key)
        const src = await PDFDocument.load(await file.arrayBuffer());
        let step = 10; const n = src.getPageCount(), tails = [Math.max(0, n - 3), Math.max(0, n - 2), n - 1].filter((x, k, a) => a.indexOf(x) === k);
        const total = Math.ceil(n / step);
        for (let s = 0, k = 1; s < n; s += step, k++) {
          setBusy(`Processing part ${k} of ${total}…`);
          const idx = [...Array(Math.min(step, n - s)).keys()].map((x) => x + s);
          tails.forEach((t) => { if (!idx.includes(t)) idx.push(t); });
          const part = await PDFDocument.create();
          (await part.copyPages(src, idx)).forEach((pg) => part.addPage(pg));
          const bytes = await part.save();
          if (bytes.length > 3.8e6 && step > 2) { step = Math.max(2, Math.floor(step / 2)); s -= step; k--; continue; }
          all = all.concat(await parseOne(new Blob([bytes], { type: "application/pdf" }), "part.pdf"));
        }
      }
      const seen = new Set();
      const qsx = all.filter((q) => { const k = q.q.toLowerCase().replace(/\s+/g, " ").slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; }).map((q, k) => ({ ...q, id: k + 1 }));
      if (!qsx.length) throw new Error("No MCQs found in this PDF.");
      setCur({ id: Date.now(), title: file.name.replace(/\.pdf$/i, ""), questions: qsx });
      setView("preview");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  function saveSet() {
    const n = [cur, ...sets.filter((s) => s.id !== cur.id)];
    setSets(n); save("sets", n); setView("setup");
  }
  const upd = (fn) => setCur((c) => ({ ...c, questions: fn(c.questions) }));

  function start(list) {
    let q = cfg.shuf ? shuffle(list) : list;
    q = q.slice(0, Math.max(1, cfg.count || q.length));
    setQs(q); setAns(Array(q.length).fill(-1)); setI(0); setLeft(cfg.min * 60); setView("test");
  }

  function finish() {
    const wrong = qs.filter((q, k) => ans[k] !== q.a);
    const tp = {}; qs.forEach((q, k) => { const t = q.t || "General"; tp[t] = tp[t] || [0, 0]; tp[t][1]++; if (ans[k] === q.a) tp[t][0]++; });
    const a = { topics: tp, day: new Date().toISOString().slice(0, 10), id: Date.now(), title: cur.title, setId: cur.id, score: qs.length - wrong.length, total: qs.length, date: new Date().toLocaleDateString(), wrong };
    const n = [a, ...atts].slice(0, 100);
    setAtts(n); save("atts", n);
    setRes({ ...a, qs, ans }); setView("result");
  }

  const isMark = (q) => marks.some((m) => m.q === q.q);
  function toggleMark(q) { const n = isMark(q) ? marks.filter((m) => m.q !== q.q) : [...marks, q]; setMarks(n); save("marks", n); }
  function startList(title, list) { setCur({ id: "x" + title, title, questions: list }); start(list); }
  function exportAll() { const b = new Blob([JSON.stringify({ sets, atts, marks })], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "mcq-backup.json"; a.click(); }
  async function importAll(f) {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      const mg = (a, b, k) => [...a, ...b.filter((x) => !a.some((y) => y[k] === x[k]))];
      const s2 = mg(sets, d.sets || [], "id"), a2 = mg(atts, d.atts || [], "id"), m2 = mg(marks, d.marks || [], "q");
      setSets(s2); setAtts(a2); setMarks(m2); save("sets", s2); save("atts", a2); save("marks", m2);
    } catch { setErr("That backup file isn't valid."); }
  }
  const del = (id) => { const n = sets.filter((s) => s.id !== id); setSets(n); save("sets", n); };
  const avg = atts.length ? Math.round(atts.reduce((s, a) => s + (a.score / a.total) * 100, 0) / atts.length) : 0;

  const days = new Set(atts.map((a) => a.day));
  let streak = 0; const dd = new Date();
  if (!days.has(dd.toISOString().slice(0, 10))) dd.setDate(dd.getDate() - 1);
  while (days.has(dd.toISOString().slice(0, 10))) { streak++; dd.setDate(dd.getDate() - 1); }
  const agg = {};
  atts.forEach((a) => Object.entries(a.topics || {}).forEach(([t, [c, n]]) => { agg[t] = agg[t] || [0, 0]; agg[t][0] += c; agg[t][1] += n; }));
  const weak = Object.entries(agg).filter(([, v]) => v[1] >= 3).map(([t, v]) => [t, Math.round((v[0] / v[1]) * 100), v[1]]).sort((x, y) => x[1] - y[1]).slice(0, 5);

  return (
    <div className="w">
      <div className="row sp hdr">
        <h1 className="brand" onClick={() => setView("home")}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="6" fill="var(--pr)" /><path d="M7.5 12.5l3 3 6-7" stroke="#fff" strokeWidth="2.4" /></svg>MCQ Test</h1>
        {supabase && (user
          ? <span className="row"><span className="mut">{user.email}</span><button className="g" onClick={() => supabase.auth.signOut()}>Sign out</button></span>
          : <span className="row">
              <button onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })}>Sign in with Google</button>
              <button className="g" onClick={async () => { const email = prompt("Enter your email"); if (!email) return; const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } }); alert(error ? error.message : "Check your inbox for the sign-in link"); }}>Sign in with email</button>
            </span>)}
      </div>

      {view === "home" && (<>
        <div className="hero"><h2>Practice smarter from your own MCQ PDFs</h2><p>Upload a PDF, review the questions, take a timed test, and track your progress.</p><div className="steps"><span><b>1</b>Upload</span><span><b>2</b>Review</span><span><b>3</b>Practice</span><span><b>4</b>Improve</span></div></div>
        <div className="c">
          <h2>Upload a PDF</h2>
          <p className="mut">Upload a PDF of MCQs. Large files are split automatically. Answers can be next to each question, in a key at the end, or marked with a tick or bold.</p>
          <input type="file" accept="application/pdf" disabled={!!busy} onChange={(e) => upload(e.target.files[0])} />
          {busy && <p>{busy}</p>}
          {err && <p className="err">{err}</p>}
        </div>
        {sets.length > 0 && <div className="c"><h2>My tests</h2>
          {sets.map((s) => (
            <div key={s.id} className="row sp" style={{ margin: "8px 0" }}>
              <span>{s.title} <span className="mut">({s.questions.length} MCQs)</span></span>
              <span className="row">
                <button onClick={() => { setCur(s); setView("setup"); }}>Test</button>
                <button className="g" onClick={() => { setCur(s); setView("preview"); }}>Edit</button>
                <button className="r" onClick={() => del(s.id)}>Delete</button>
              </span>
            </div>))}
        </div>}
        {atts.length > 0 && <div className="c"><h2>Progress</h2>
          <div className="stats"><div><b>{atts.length}</b><span>Tests taken</span></div><div><b>{avg}%</b><span>Average score</span></div><div><b>{streak}</b><span>Day streak</span></div></div>
          <div className="bars">{[...atts].reverse().slice(-20).map((a) => <div key={a.id} className="bar" title={`${a.title}: ${a.score}/${a.total}`} style={{ height: Math.max(4, (a.score / a.total) * 100) + "%" }} />)}</div>
          <p className="mut">Each bar is one test's score, oldest to newest</p>
          {atts.slice(0, 8).map((a) => <div key={a.id} className="row sp mut"><span>{a.date} · {a.title}</span><b>{a.score}/{a.total}</b></div>)}
        </div>}
        <div className="c">
          <h2>Insights</h2>
          <p>Streak: <b>{streak}</b> days · Bookmarks: <b>{marks.length}</b></p>
          {weak.length > 0 && <><b>Weak topics</b>{weak.map(([t, pc, n]) => <div key={t} className="row sp mut"><span>{t}</span><b>{pc}% ({n} q)</b></div>)}</>}
          <div className="row" style={{ marginTop: 8 }}>
            {marks.length > 0 && <button onClick={() => startList("Bookmarks", marks)}>Bookmarked test</button>}
            <button className="g" onClick={exportAll}>Export backup</button>
            <label className="b g" style={{ background: "#e5e7eb", color: "#111" }}>Import backup<input type="file" accept=".json" hidden onChange={(e) => importAll(e.target.files[0])} /></label>
          </div>
          <p className="mut">Use a backup file to move your data to another device or share it.</p>
        </div>
      </>)}

      {view === "preview" && cur && (<>
        <div className="c">
          <h2>{cur.title}: {cur.questions.length} MCQs</h2>
          <p className="mut">If an answer is wrong, click the correct option to fix it. Questions marked <span className="tag">AI answer</span> had no answer in the PDF, so please verify them.</p>
          <div className="row"><button onClick={saveSet}>Save and continue</button><button className="g" onClick={() => setView("home")}>Back</button></div>
        </div>
        {cur.questions.map((q, k) => (
          <div className="c" key={q.id}>
            <div className="row sp"><b>{k + 1}. {q.q}</b>
              <button className="r" onClick={() => upd((a) => a.filter((x) => x.id !== q.id))}>Delete</button></div>
            {q.s === "ai" && <span className="tag">AI answer</span>}
            {q.a < 0 && <span className="tag err"> Select the correct answer</span>}
            {q.o.map((o, j) => <button key={j} className={"o " + (q.a === j ? "ok" : "")} onClick={() => upd((a) => a.map((x) => x.id === q.id ? { ...x, a: j, s: "pdf" } : x))}>{L[j]}. {o}</button>)}
          </div>))}
      </>)}

      {view === "setup" && cur && (
        <div className="c">
          <h2>{cur.title}</h2>
          <p>Number of questions (max {cur.questions.length}): <input type="number" min="1" value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: +e.target.value })} /></p>
          <p>Timer in minutes (0 = off): <input type="number" min="0" value={cfg.min} onChange={(e) => setCfg({ ...cfg, min: +e.target.value })} /></p>
          <p><label><input type="checkbox" checked={cfg.shuf} onChange={(e) => setCfg({ ...cfg, shuf: e.target.checked })} /> Random order</label></p>
          <button onClick={() => start(cur.questions)}>Start test</button>
        </div>)}

      {view === "test" && qs[i] && (<div className="c">
        <div className="row sp"><b>{i + 1} / {qs.length}</b>{cfg.min > 0 && <b>{Math.floor(Math.max(0, left) / 60)}:{String(Math.max(0, left) % 60).padStart(2, "0")}</b>}</div>
        <div className="pb"><div style={{ width: ((i + 1) / qs.length) * 100 + "%" }} /></div>
        <div className="nav">{qs.map((_, k) => <button key={k} className={"nv" + (k === i ? " cur" : "") + (ans[k] >= 0 ? " dn" : "")} onClick={() => setI(k)} aria-label={"Question " + (k + 1)}>{k + 1}</button>)}</div>
        <h2>{qs[i].q}</h2>
        {qs[i].o.map((o, j) => <button key={j} className={"o " + (ans[i] === j ? "s" : "")} onClick={() => setAns(ans.map((x, k) => k === i ? j : x))}>{L[j]}. {o}</button>)}
        <button className="g" onClick={() => toggleMark(qs[i])}>{isMark(qs[i]) ? "Bookmarked" : "Bookmark"}</button>
        <div className="row sp" style={{ marginTop: 12 }}>
          <button className="g" disabled={i === 0} onClick={() => setI(i - 1)}>Previous</button>
          {i < qs.length - 1 ? <button onClick={() => setI(i + 1)}>Next</button> : <button onClick={finish}>Submit</button>}
        </div>
        <p className="mut">Answered: {ans.filter((x) => x >= 0).length}/{qs.length} · <a href="#" onClick={(e) => { e.preventDefault(); if (confirm("Submit the test?")) finish(); }}>submit now</a></p>
      </div>)}

      {view === "result" && res && (<>
        <div className="c">
          <div className="score"><div className="ring" style={{ "--p": Math.round((res.score / res.total) * 100) }}><b>{Math.round((res.score / res.total) * 100)}%</b></div><div><h2>{res.score} of {res.total} correct</h2><p className="mut">{res.wrong.length} to review</p></div></div>
          <div className="row">
            {res.wrong.length > 0 && <button onClick={() => start(res.wrong)}>Retry incorrect ({res.wrong.length})</button>}
            <button className="g" onClick={() => setView("setup")}>Retake</button>
            <button className="g" onClick={() => window.print()}>PDF / Print</button>
            <button className="g" onClick={() => setView("home")}>Home</button>
          </div>
        </div>
        {res.qs.map((q, k) => (<div className="c" key={k}>
          <b>{k + 1}. {q.q}</b>
          {q.o.map((o, j) => <div key={j} className={"o " + (j === q.a ? "ok" : res.ans[k] === j ? "bad" : "")} style={{ padding: 10, borderRadius: 8 }}>{L[j]}. {o}{res.ans[k] === j ? " (your answer)" : ""}</div>)}
          {res.ans[k] < 0 && <p className="err">Skipped</p>}
          <button className="g" onClick={() => toggleMark(q)}>{isMark(q) ? "Bookmarked" : "Bookmark"}</button>
          {q.e && <p className="mut">Explanation: {q.e}</p>}
        </div>))}
      </>)}
    </div>
  );
}
