# MCQ Test
1. GitHub repo mein ye saari files upload karo.
2. Vercel > Import Project > repo select.
3. Environment Variable: GEMINI_API_KEY = (aistudio.google.com se free key)
4. Deploy.
Limit: PDF 4MB tak (Vercel free). Bari PDF ko tukron mein baant lo.

Bari PDF (>3.5MB) khud 10-page ke tukron mein parse hoti hai.

## Login + database (Supabase)
1. supabase.com par project banao, SQL Editor mein supabase.sql chalao.
2. Settings > API: Project URL aur anon public key copy karo.
3. Vercel Environment Variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, phir Redeploy.
4. Authentication > URL Configuration: Site URL = apna Vercel link, Redirect URLs mein link/** .
5. Google login ke liye Authentication > Providers > Google (Google Cloud OAuth client). Ya sirf Email link use karo.
