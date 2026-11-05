import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are Gyaanio AdCheck, a compliance reviewer for Dubai real estate advertisements. You check a listing ad against the Dubai Land Department (DLD) and RERA advertising rules. Be strict, specific and practical. Never invent facts about the property. Only judge what is in the ad text.

RULES TO CHECK (every ad, including social media posts):
1. PERMIT: A valid Trakheesi advertising permit number must be shown in the ad. Missing or clearly fake looking permit = FAIL.
2. QR CODE: The DLD Madmoun QR code (issued with the Trakheesi permit) must appear on the ad. Mandatory since 24 April 2023. If the ad text does not mention or include a QR code, flag as FAIL unless the user states it is on the creative.
3. BROKERAGE IDENTITY: The licensed brokerage name and its RERA ORN (office registration number) should appear. The agent's BRN (broker registration number) is strongly recommended.
4. OFF PLAN: If the property is off plan, the ad must show the developer name, the escrow account number and the expected completion date. Missing any = FAIL.
5. ACCURACY: Price, size, bedrooms, location and payment plan must be stated clearly and must not be misleading. Flag vague or contradictory numbers.
6. PROHIBITED CLAIMS: Flag guaranteed returns, guaranteed ROI percentages stated as certain, "risk free", guaranteed visa or residency promises, fake urgency, claims the agent cannot substantiate, or promoting a property or project without the owner's or developer's authorisation (Form A for resale, developer NOC for primary sales).
7. ONE PERMIT PER LISTING: Reusing another listing's permit number, expired permits, or manipulated permit numbers are violations.

PENALTIES: Fines start at AED 50,000 per violation, double on repeat, and can lead to licence suspension.

If the text was extracted from a web page, it may contain navigation or boilerplate. Judge only the listing content and ignore site chrome.

Respond ONLY with valid JSON in this exact shape, no markdown fences, no text before or after the JSON:
{
  "verdict": "PASS" | "FIX NEEDED" | "FAIL",
  "score": 0-100,
  "summary": "one sentence",
  "checks": [
    {"rule": "Trakheesi permit number", "status": "pass"|"warn"|"fail", "finding": "what you found", "fix": "exact fix or empty string"},
    ... one object per rule 1 to 7 ...
  ],
  "rewritten_ad": "a corrected, compliant version of the ad with [PLACEHOLDERS] where the agent must insert real details such as [TRAKHEESI PERMIT NO] or [ESCROW ACCOUNT NO]. Keep the agent's tone. No dashes of any kind in the text."
}

Keep each finding and fix to one or two sentences. Scoring: FAIL if any fail on rules 1, 2, 4 or 6. FIX NEEDED if only warns. PASS only if everything passes. Write in plain English. Never use em dashes, en dashes or hyphens anywhere in your output.`;

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("no json");
}

const BLOCKED: Array<[RegExp, string]> = [
  [/instagram\.com/i, "Instagram does not allow links to be read. Open the post, copy the caption and paste it here."],
  [/facebook\.com|fb\.com|fb\.watch/i, "Facebook does not allow links to be read. Copy the ad text and paste it here."],
  [/tiktok\.com/i, "TikTok does not allow links to be read. Copy the caption and paste it here."],
  [/linkedin\.com/i, "LinkedIn does not allow links to be read. Copy the post text and paste it here."],
  [/wa\.me|whatsapp\.com/i, "WhatsApp links cannot be read. Paste the broadcast text here."],
  [/youtube\.com|youtu\.be/i, "YouTube links cannot be read. Paste the video description here."],
];

function decodeEntities(s: string) {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const metas: string[] = [];
  for (const m of html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description|og:title)["'][^>]*content=["']([^"']*)["']/gi)) metas.push(decodeEntities(m[1]));
  let body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ");
  body = body.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n").replace(/<[^>]+>/g, " ");
  body = decodeEntities(body).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return { title, text: [title, ...metas, body].filter(Boolean).join("\n") };
}

async function fetchPage(url: string): Promise<{ ok: true; text: string; final: string } | { ok: false; error: string }> {
  for (const [re, msg] of BLOCKED) if (re.test(url)) return { ok: false, error: msg };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-AE,en;q=0.9",
      },
    });
    const final = r.url || url;
    for (const [re, msg] of BLOCKED) if (re.test(final)) return { ok: false, error: msg };
    if (!r.ok) return { ok: false, error: `The page could not be opened (status ${r.status}). Copy the ad text and paste it here.` };
    const ct = r.headers.get("content-type") || "";
    if (!/html|xml|text/i.test(ct)) return { ok: false, error: "That link is not a web page. Copy the ad text and paste it here." };
    const html = (await r.text()).slice(0, 1_500_000);
    const { text } = htmlToText(html);
    const head = text.slice(0, 1500);
    if (/just a moment|verify you are human|are you a robot|access denied|attention required|bot detection|cloudflare|press and hold|enable javascript and cookies|request blocked/i.test(head) && text.length < 4000) {
      return { ok: false, error: `${new URL(final).hostname.replace(/^www\./, "")} blocks automated reading. Open the listing, copy the description and paste it here.` };
    }
    if (text.replace(/\s+/g, " ").length < 120) return { ok: false, error: "The page loaded but has no readable ad text (it may need JavaScript or a login). Copy the ad text and paste it here." };
    return { ok: true, text: text.slice(0, 6000), final };
  } catch {
    return { ok: false, error: "The page could not be reached. Copy the ad text and paste it here." };
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY secret not set" }, 500);

  let body: { ad?: string; offplan?: boolean; has_qr?: boolean };
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  let ad = (body.ad || "").trim();
  let source: { type: "text" } | { type: "url"; url: string; note: string } = { type: "text" };

  // A single URL (optionally with surrounding whitespace) means: fetch the page and check its content.
  const urlMatch = ad.match(/^(https?:\/\/[^\s]+)$/i) || (ad.length < 400 && ad.match(/^(?:[^\s]*\s){0,3}(https?:\/\/[^\s]+)\s*$/i));
  if (urlMatch) {
    const url = urlMatch[1];
    const page = await fetchPage(url);
    if (!page.ok) return json({ error: page.error }, 422);
    ad = page.text;
    let host = "";
    try { host = new URL(page.final).hostname.replace(/^www\./, ""); } catch { host = ""; }
    const landed = page.final !== url && /googleadservices|doubleclick|gclid=|utm_/i.test(url);
    source = {
      type: "url",
      url: page.final,
      note: landed
        ? `This was an ad click link, so AdCheck checked the landing page on ${host}, not the ad copy itself. To check the ad text, paste it here.`
        : `AdCheck read the listing text from ${host}. Anything shown only in images, such as a QR code, is not visible to it.`,
    };
  }

  if (ad.length < 20) return json({ error: "Paste the full ad text (at least 20 characters)" }, 400);
  if (ad.length > 6000) ad = ad.slice(0, 6000);

  const user = `AD TEXT${source.type === "url" ? " (extracted from " + source.url + ")" : ""}:\n"""\n${ad}\n"""\n\nAgent declarations: property is ${body.offplan ? "OFF PLAN" : "not declared off plan (judge from the text)"}; QR code on the creative: ${body.has_qr ? "YES, agent confirms the Madmoun QR code is on the image or video" : "NOT confirmed"}.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: user }] }),
  });

  if (!r.ok) {
    const t = await r.text();
    return json({ error: "Model error", detail: t.slice(0, 300) }, 502);
  }
  const data = await r.json();
  const text = (data.content || []).map((c: { text?: string }) => c.text || "").join("");
  if (data.stop_reason === "max_tokens") return json({ error: "Result was cut off, try a shorter ad", raw: text.slice(0, 500) }, 502);
  try {
    const parsed = extractJson(text) as Record<string, unknown>;
    if (source.type === "url") { parsed.source_url = source.url; parsed.source_note = source.note; }
    return json(parsed);
  } catch {
    return json({ error: "Could not parse result", raw: text.slice(0, 500) }, 502);
  }
});
