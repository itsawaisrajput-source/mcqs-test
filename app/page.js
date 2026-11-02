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
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Error");
    return d.questions;
  }

  async function upload(file) {
    if (!file) return;
    setErr(""); setBusy("MCQs nikal raha hon...");
    try {
      let all = [];
      if (file.size <= 3.5 * 1024 * 1024) {
        all = await parseOne(file, file.name);
      } else {
        // bari PDF: 10-10 pages ke tukre + har tukre ke saath aakhri 3 pages (answer key ke liye)
        const src = await PDFDocument.load(await file.arrayBuffer());
        const n = src.getPageCount(), step = 10, tails = [Math.max(0, n - 3), Math.max(0, n - 2), n - 1].filter((x, k, a) => a.indexOf(x) === k);
        const total = Math.ceil(n / step);
        for (let s = 0, k = 1; s < n; s += step, k++) {
          setBusy(`Hissa ${k}/${total} process ho raha hai...`);
          const idx = [...Array(Math.min(step, n - s)).keys()].map((x) => x + s);
          tails.forEach((t) => { if (!idx.includes(t)) idx.push(t); });
          const part = await PDFDocument.create();
          (await part.copyPages(src, idx)).forEach((pg) => part.addPage(pg));
          const bytes = await part.save();
          all = all.concat(await parseOne(new Blob([bytes], { type: "application/pdf" }), "part.pdf"));
        }
      }
      const seen = new Set();
      const qsx = all.filter((q) => { const k = q.q.toLowerCase().replace(/\s+/g, " ").slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; }).map((q, k) => ({ ...q, id: k + 1 }));
      if (!qsx.length) throw new Error("Koi MCQ nahi mila.");
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
    } catch { setErr("Backup file sahi nahi hai."); }
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
      <div className="row sp">
        <h1 onClick={() => setView("home")} style={{ cursor: "pointer" }}>📝 MCQ Test</h1>
        {supabase && (user
          ? <span className="row"><span className="mut">{user.email}</span><button className="g" onClick={() => supabase.auth.signOut()}>Logout</button></span>
          : <span className="row">
              <button onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })}>Google login</button>
              <button className="g" onClick={async () => { const email = prompt("Email daalo"); if (!email) return; const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } }); alert(error ? error.message : "Email par login link bheja hai"); }}>Email link</button>
            </span>)}
      </div>

      {view === "home" && (<>
        <div className="c">
          <h2>PDF upload karo</h2>
          <p className="mut">MCQs wali PDF do. Bari PDF bhi chalegi (khud tukron mein baant leta hon). Answers har question ke saath hon, end mein key ho, ya tick/bold se marked hon, sab chalega.</p>
          <input type="file" accept="application/pdf" disabled={!!busy} onChange={(e) => upload(e.target.files[0])} />
          {busy && <p>{busy}</p>}
          {err && <p className="err">{err}</p>}
        </div>
        {sets.length > 0 && <div className="c"><h2>Meri tests</h2>
          {sets.map((s) => (
            <div key={s.id} className="row sp" style={{ margin: "8px 0" }}>
              <span>{s.title} <span className="mut">({s.questions.length} MCQs)</span></span>
              <span className="row">
                <button onClick={() => { setCur(s); setView("setup"); }}>Test</button>
                <button className="g" onClick={() => { setCur(s); setView("preview"); }}>Edit</button>
                <button className="r" onClick={() => del(s.id)}>X</button>
              </span>
            </div>))}
        </div>}
        {atts.length > 0 && <div className="c"><h2>Progress</h2>
          <p>Tests: <b>{atts.length}</b> · Average: <b>{avg}%</b></p>
          <div className="bars">{[...atts].reverse().slice(-20).map((a) => <div key={a.id} className="bar" title={`${a.title}: ${a.score}/${a.total}`} style={{ height: Math.max(4, (a.score / a.total) * 100) + "%" }} />)}</div>
          <p className="mut">Har bar = ek test ka score% (purane se naye)</p>
          {atts.slice(0, 8).map((a) => <div key={a.id} className="row sp mut"><span>{a.date} · {a.title}</span><b>{a.score}/{a.total}</b></div>)}
        </div>}
        <div className="c">
          <h2>Tools</h2>
          <p>🔥 Streak: <b>{streak}</b> din · ★ Bookmarks: <b>{marks.length}</b></p>
          {weak.length > 0 && <><b>Kamzor topics</b>{weak.map(([t, pc, n]) => <div key={t} className="row sp mut"><span>{t}</span><b>{pc}% ({n} q)</b></div>)}</>}
          <div className="row" style={{ marginTop: 8 }}>
            {marks.length > 0 && <button onClick={() => startList("Bookmarks", marks)}>Bookmarked test</button>}
            <button className="g" onClick={exportAll}>Backup / Share download</button>
            <label className="b g" style={{ background: "#e5e7eb", color: "#111" }}>Backup import<input type="file" accept=".json" hidden onChange={(e) => importAll(e.target.files[0])} /></label>
          </div>
          <p className="mut">Backup file se data doosre phone/laptop par ya dost ko bheja ja sakta hai.</p>
        </div>
      </>)}

      {view === "preview" && cur && (<>
        <div className="c">
          <h2>{cur.title}: {cur.questions.length} MCQs</h2>
          <p className="mut">Sahi answer galat ho to option par click karke theek kar do. <span className="tag">AI answer</span> wale questions check kar lo (PDF mein answer nahi mila tha).</p>
          <div className="row"><button onClick={saveSet}>Save karo ➜ Test</button><button className="g" onClick={() => setView("home")}>Wapas</button></div>
        </div>
        {cur.questions.map((q, k) => (
          <div className="c" key={q.id}>
            <div className="row sp"><b>{k + 1}. {q.q}</b>
              <button className="r" onClick={() => upd((a) => a.filter((x) => x.id !== q.id))}>🗑</button></div>
            {q.s === "ai" && <span className="tag">AI answer</span>}
            {q.a < 0 && <span className="tag err"> answer select karo</span>}
            {q.o.map((o, j) => <button key={j} className={"o " + (q.a === j ? "ok" : "")} onClick={() => upd((a) => a.map((x) => x.id === q.id ? { ...x, a: j, s: "pdf" } : x))}>{L[j]}. {o}</button>)}
          </div>))}
      </>)}

      {view === "setup" && cur && (
        <div className="c">
          <h2>{cur.title}</h2>
          <p>Kitne questions (max {cur.questions.length}): <input type="number" min="1" value={cfg.count} onChange={(e) => setCfg({ ...cfg, count: +e.target.value })} /></p>
          <p>Timer (minute, 0 = off): <input type="number" min="0" value={cfg.min} onChange={(e) => setCfg({ ...cfg, min: +e.target.value })} /></p>
          <p><label><input type="checkbox" checked={cfg.shuf} onChange={(e) => setCfg({ ...cfg, shuf: e.target.checked })} /> Random order</label></p>
          <button onClick={() => start(cur.questions)}>Test shuru karo</button>
        </div>)}

      {view === "test" && qs[i] && (<div className="c">
        <div className="row sp"><b>{i + 1} / {qs.length}</b>{cfg.min > 0 && <b>⏱ {Math.floor(Math.max(0, left) / 60)}:{String(Math.max(0, left) % 60).padStart(2, "0")}</b>}</div>
        <h2>{qs[i].q}</h2>
        {qs[i].o.map((o, j) => <button key={j} className={"o " + (ans[i] === j ? "s" : "")} onClick={() => setAns(ans.map((x, k) => k === i ? j : x))}>{L[j]}. {o}</button>)}
        <button className="g" onClick={() => toggleMark(qs[i])}>{isMark(qs[i]) ? "★" : "☆"} Bookmark</button>
        <div className="row sp" style={{ marginTop: 12 }}>
          <button className="g" disabled={i === 0} onClick={() => setI(i - 1)}>◀ Pichla</button>
          {i < qs.length - 1 ? <button onClick={() => setI(i + 1)}>Agla ▶</button> : <button onClick={finish}>Submit</button>}
        </div>
        <p className="mut">Jawab diye: {ans.filter((x) => x >= 0).length}/{qs.length} · <a href="#" onClick={(e) => { e.preventDefault(); if (confirm("Test submit karen?")) finish(); }}>abhi submit</a></p>
      </div>)}

      {view === "result" && res && (<>
        <div className="c">
          <h2>Score: {res.score}/{res.total} ({Math.round((res.score / res.total) * 100)}%)</h2>
          <div className="row">
            {res.wrong.length > 0 && <button onClick={() => start(res.wrong)}>Galat answers dobara ({res.wrong.length})</button>}
            <button className="g" onClick={() => setView("setup")}>Dobara test</button>
            <button className="g" onClick={() => window.print()}>PDF / Print</button>
            <button className="g" onClick={() => setView("home")}>Home</button>
          </div>
        </div>
        {res.qs.map((q, k) => (<div className="c" key={k}>
          <b>{k + 1}. {q.q}</b>
          {q.o.map((o, j) => <div key={j} className={"o " + (j === q.a ? "ok" : res.ans[k] === j ? "bad" : "")} style={{ padding: 10, borderRadius: 8 }}>{L[j]}. {o}{res.ans[k] === j ? " ← aap ka jawab" : ""}</div>)}
          {res.ans[k] < 0 && <p className="err">Chhora hua</p>}
          <button className="g" onClick={() => toggleMark(q)}>{isMark(q) ? "★ Bookmarked" : "☆ Bookmark"}</button>
          {q.e && <p className="mut">💡 {q.e}</p>}
        </div>))}
      </>)}
    </div>
  );
}
