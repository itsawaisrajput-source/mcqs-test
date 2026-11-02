export const maxDuration = 60;

const PROMPT = `Is PDF mein se saare MCQs nikalo. Sirf JSON array do, is format mein:
[{"q":"question text","o":["option A text","option B text",...],"a":0,"e":"short explanation ya ''","t":"topic/subject 1-3 words","s":"pdf"}]
Rules:
- "a" sahi option ka 0-based index hai (A=0, B=1...). Options ke labels (A), B. waghera) text se hata do.
- Correct answer ka source alag alag ho sakta hai: har question ke saath (Ans:/Answer:/Correct:), PDF ke end mein answer key (jaise "1-B, 2-C", table, ya list), tick/bold/highlight/underline wala option, ya explanation. Question number se match karo. Sab jagah dekho.
- Agar PDF mein answer mil jaye to "s":"pdf". Agar kisi question ka answer PDF mein bilkul nahi hai, to khud sahi answer socho aur "s":"ai" likho.
- PDF ka answer aur tumhari raye alag hon to PDF ka answer rakho.
- Explanation PDF mein ho to wohi lo, warna ek chhoti line khud likho.
- Question/options ki zaban (Urdu/English) bilkul wahi rakho. Koi MCQ mat chhoro, kuch bhi nayi mat banao. Diagram wale question bhi shamil karo agar text samajh aaye.`;

export async function POST(req) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return Response.json({ error: "GEMINI_API_KEY is not set (Vercel environment variables)." }, { status: 500 });
    const fd = await req.formData();
    const f = fd.get("file");
    if (!f) return Response.json({ error: "No file received." }, { status: 400 });
    const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: "application/pdf", data: b64 } }, { text: PROMPT }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 60000 },
      }),
    });
    const d = await r.json();
    if (!r.ok) return Response.json({ error: d.error?.message || "Gemini error" }, { status: 502 });
    let text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    text = text.replace(/```json|```/g, "").trim();
    let arr;
    try { arr = JSON.parse(text); } catch { return Response.json({ error: "Couldn't read the AI response. Try a smaller PDF." }, { status: 502 }); }
    const questions = (Array.isArray(arr) ? arr : [])
      .filter((x) => x && x.q && Array.isArray(x.o) && x.o.length >= 2)
      .map((x, i) => ({
        id: i + 1,
        q: String(x.q),
        o: x.o.map(String),
        a: Number.isInteger(x.a) && x.a >= 0 && x.a < x.o.length ? x.a : -1,
        e: x.e ? String(x.e) : "",
        t: x.t ? String(x.t) : "General",
        s: x.s === "pdf" ? "pdf" : "ai",
      }));
    if (!questions.length) return Response.json({ error: "No MCQs found." }, { status: 422 });
    return Response.json({ questions });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
