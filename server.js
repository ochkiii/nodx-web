// NODX Web — Article Analyzer
// node server.js → http://localhost:3000

import express from 'express';
import { load as cheerioLoad } from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { jsonrepair } from 'jsonrepair';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
try { dotenv.config({ path: join(__dirname, '../.env') }); } catch (_) {}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-sonnet-4-6';
const API_KEY = process.env.ANTHROPIC_API_KEY;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const CLAUDE_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'prompt-caching-2024-07-31',
};

// ── Article scraper ───────────────────────────────────────────────
async function fetchArticle(url) {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 404) throw new Error(`Page not found (404)`);
  // 403/429 — try to parse whatever came back before giving up
  const html = await res.text();
  if (!html || html.length < 100) throw new Error(`Site blocked the request (${res.status})`);
  const $ = cheerioLoad(html);

  // Meta
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text() ||
    $('h1').first().text() || '';

  const description =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') || '';

  const ogImage =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') || '';

  const author =
    $('meta[name="author"]').attr('content') ||
    $('[rel="author"]').first().text() ||
    $('[class*="author"]').first().text().trim().slice(0, 60) || '';

  const datePublished =
    $('meta[property="article:published_time"]').attr('content') ||
    $('time').first().attr('datetime') || '';

  const siteName =
    $('meta[property="og:site_name"]').attr('content') ||
    new URL(url).hostname.replace('www.', '');

  // Body text — Readability first, cheerio fallback
  let bodyText = '';
  try {
    const dom = new JSDOM(html.slice(0, 200_000), { url }); // cap before JSDOM to avoid slow parse on huge pages
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    if (parsed?.textContent?.length > 200) {
      bodyText = parsed.textContent.replace(/\s{3,}/g, '\n\n').trim().slice(0, 8000);
    }
  } catch {}

  if (bodyText.length < 200) {
    const articleEl = $('article, [role="main"], main, .post-content, .entry-content, .article-body, .story-body').first();
    const source = articleEl.length ? articleEl : $('body');
    source.find('p').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 40) bodyText += t + '\n\n';
    });
    if (bodyText.length < 200) {
      $('h2, h3, p').each((_, el) => {
        const t = $(el).text().trim();
        if (t.length > 20) bodyText += t + '\n\n';
      });
    }
    bodyText = bodyText.slice(0, 8000);
  }

  // Images
  const images = [];
  if (ogImage) images.push({ src: ogImage, alt: title, type: 'og' });
  const articleEl2 = $('article, [role="main"], main, .post-content, .entry-content, .article-body, .story-body').first();
  const imgSource = articleEl2.length ? articleEl2 : $('body');
  imgSource.find('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    const alt = $(el).attr('alt') || '';
    if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar')) {
      if (!images.find(i => i.src === src)) images.push({ src, alt, type: 'inline' });
    }
  });

  // Videos
  const videos = [];
  $('iframe[src*="youtube"], iframe[src*="youtu.be"]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src) videos.push({ src, type: 'youtube' });
  });
  $('video source, video[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src) videos.push({ src, type: 'video' });
  });

  return {
    url,
    title: title.trim(),
    description: description.trim(),
    author: author.trim(),
    datePublished,
    siteName,
    bodyText,
    images: images.slice(0, 8),
    videos: videos.slice(0, 3),
  };
}

// ── Claude system prompt (cached) ─────────────────────────────────
const SYSTEM_PROMPT = `You are the NODX MEDIA article analyzer.

NODX is an independent editorial signal feed for filmmakers, colorists, and creators building with AI tools.

Your job: read the article → extract signal → produce a complete content package across every format.

VOICE RULES (every output must pass these):
- Sentence case. Active voice. No exclamation marks.
- Banned words: game-changer, revolutionary, groundbreaking, unprecedented, disrupting, unlock, journey, exploring, seamless, powerful, dive
- Write like a colorist who reads a lot, not a tech journalist
- Short sentences hit harder. Use that.
- NODX always has a position — no neutral reporting

HEADLINE RULE — headlines are arguments, not summaries:
  ✗ "Resolve 21 adds new still image tools" — news summary, never do this
  ✓ "Blackmagic just made Lightroom irrelevant for colorists" — argument with tension
  If the headline could appear in a press release, rewrite it. Maximum 10 words. Sentence case.

FUNNEL STAGE — classify this content into exactly one stage:
  attention: broad signal, no assumed knowledge, best for new audience reach
  paradigm-shift: challenges a belief the audience already holds — best for engagement and saves
  proof: evidence, results, case studies — builds trust with warm audience
  nurture: depth, methodology, how-to — keeps and deepens existing audience
  conversion: specific action, tool or offer recommendation — warm audience only

HOOK FORMULA BANK — generate one hook per formula, all 5:
  contrarian truth: challenge the obvious take. Spoken.
  specific mistake: name the exact error a specific person makes.
  identity signal: speak directly to the person. "If you're a [specific role]..."
  assumption flip: name the assumption, then flip it. "You think X. It's actually Y."
  pattern interrupt: start with an unexpected specific number, claim, or visual image.
Rules: 1-2 sentences max. Spoken out loud. Under 20 words. Ready to record as-is.


OUTPUT — return ONLY valid JSON:
{
  "keywords": ["5-10 key terms — tool names, companies, techniques, concepts"],
  "key_notes": ["3-5 bullet points — the actual facts, not fluff"],
  "mini_analysis": "2-3 sharp sentences. The NODX editorial read. Specific, not generic.",
  "nodx_take": "One sentence thesis. Max 12 words. No hedging.",
  "series": "Tool Report | Industry Shift | AI Watch | The Miss",
  "funnel_stage": {
    "stage": "attention | paradigm-shift | proof | nurture | conversion",
    "reason": "one sentence — what quality of this content maps to that stage",
    "deploy": "one sentence — where and when to use this in a content sequence"
  },
  "mongolian_note": "1-2 sentences for Mongolian filmmakers/colorists in Ulaanbaatar. Pricing, access, relevance. Direct, no fluff.",
  "hook_variants": [
    { "type": "contrarian truth", "hook": "spoken hook, max 20 words" },
    { "type": "specific mistake", "hook": "..." },
    { "type": "identity signal", "hook": "..." },
    { "type": "assumption flip", "hook": "..." },
    { "type": "pattern interrupt", "hook": "..." }
  ],
  "threads_post": "1-3 sentences. Blunt. Opinionated. Publish before carousel.",
  "best_line": "The single most quotable line from all output",
  "caption": "Full Instagram caption: nodx_take restated + 1-2 sentence expansion + 'Send this to [specific person]' + series hashtag + 2-4 niche hashtags"
}
No preamble. No explanation. JSON only.`;

// System message array with prompt cache control
const SYSTEM_MSG = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

// ── Mongolian translation prompt ───────────────────────────────────
const MN_SYSTEM_PROMPT = `You translate social media hooks into Mongolian for filmmakers and colorists in Ulaanbaatar.

Return ONLY valid JSON — an array matching this exact format:
[{"type":"...","hook":"Mongolian text here"},...]

Rules:
- Natural spoken Mongolian — not formal written style
- Preserve the hook formula structure (contrarian stays contrarian, etc.)
- Max 20 words per hook
- Keep technical terms in English: DaVinci Resolve, AI, LUT, grade, premiere, VFX, color, etc.
- No preamble. No explanation. JSON only.`;

// ── Regenerate prompts per field ───────────────────────────────────
const REGEN_PROMPTS = {
  caption:      'Rewrite the Instagram caption only. Return ONLY the caption text — no JSON wrapper, no explanation.',
  threads_post: 'Rewrite the Threads post only. Return ONLY the post text — no JSON wrapper. 1-3 sentences, blunt, opinionated.',
  hook_variants:'Generate 5 new hooks. Return ONLY valid JSON array: [{"type":"contrarian truth","hook":"..."},{"type":"specific mistake","hook":"..."},{"type":"identity signal","hook":"..."},{"type":"assumption flip","hook":"..."},{"type":"pattern interrupt","hook":"..."}]',
  nodx_take:    'Write a stronger, sharper editorial thesis (nodx_take). Return ONLY the one-sentence thesis — no JSON, no explanation. Max 12 words.',
};

// ── Helpers ────────────────────────────────────────────────────────
function buildUserContent(article) {
  const imageList = article.images.map((img, i) => `[${i}] ${img.alt || 'image'}: ${img.src}`).join('\n');
  return `ARTICLE URL: ${article.url}
SOURCE: ${article.siteName}
TITLE: ${article.title}
DESCRIPTION: ${article.description}
AUTHOR: ${article.author}
DATE: ${article.datePublished}

IMAGES AVAILABLE:
${imageList || 'None extracted'}

ARTICLE TEXT:
${article.bodyText}`;
}

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering
  res.flushHeaders();
  return (obj) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    }
  };
}

// ── Claude streaming helper ────────────────────────────────────────
async function streamClaude(body, onDelta, signal) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: CLAUDE_HEADERS,
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);

  let accumulated = '';
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop();
    for (const event of events) {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            accumulated += ev.delta.text;
            onDelta(ev.delta.text);
          }
        } catch {}
      }
    }
  }

  const text = accumulated.replace(/```json|```/g, '').trim();
  try { return JSON.parse(text); }
  catch { return JSON.parse(jsonrepair(text)); }
}

// ── Routes ────────────────────────────────────────────────────────

// Fetch article only
app.post('/fetch-article', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const article = await fetchArticle(url);
    res.json({ article });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Streaming analysis (primary)
app.post('/analyze-stream', async (req, res) => {
  const send = sseSetup(res);
  const { url, article: providedArticle } = req.body;
  if (!url && !providedArticle) {
    send({ type: 'error', error: 'url or article required' });
    return res.end();
  }

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  // Keep-alive ping every 5s so the client knows we're still working
  const ping = setInterval(() => send({ type: 'ping' }), 5000);

  // Hard cap — if the whole thing takes over 90s something is wrong
  const timeout = setTimeout(() => {
    clearInterval(ping);
    send({ type: 'error', error: 'Request timed out (90s)' });
    res.end();
  }, 90_000);

  try {
    const article = providedArticle || await fetchArticle(url);
    send({ type: 'article', article });

    const analysis = await streamClaude(
      { model: MODEL, max_tokens: 1500, system: SYSTEM_MSG, messages: [{ role: 'user', content: buildUserContent(article) }] },
      (text) => send({ type: 'delta', text }),
      ac.signal
    );

    send({ type: 'done', article, analysis });
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      send({ type: 'error', error: err.message });
    }
  } finally {
    clearInterval(ping);
    clearTimeout(timeout);
  }
  res.end();
});

// Non-streaming fallback
app.post('/analyze', async (req, res) => {
  const { url, article: providedArticle } = req.body;
  if (!url && !providedArticle) return res.status(400).json({ error: 'url or article required' });
  try {
    const article = providedArticle || await fetchArticle(url);
    const analysis = await streamClaude(
      { model: MODEL, max_tokens: 1500, system: SYSTEM_MSG, messages: [{ role: 'user', content: buildUserContent(article) }] },
      () => {}
    );
    res.json({ article, analysis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Mongolian hook translation
app.post('/translate-hooks', async (req, res) => {
  const { hooks } = req.body;
  if (!hooks?.length) return res.status(400).json({ error: 'hooks required' });
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: CLAUDE_HEADERS,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: MN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Translate these hooks to Mongolian:\n${JSON.stringify(hooks, null, 2)}` }],
      }),
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const data = await r.json();
    const text = data.content[0].text.replace(/```json|```/g, '').trim();
    let mn_hooks;
    try { mn_hooks = JSON.parse(text); }
    catch { mn_hooks = JSON.parse(jsonrepair(text)); }
    res.json({ mn_hooks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Regenerate single field
app.post('/regenerate', async (req, res) => {
  const { article, field, currentAnalysis } = req.body;
  if (!article || !field) return res.status(400).json({ error: 'article and field required' });
  const regenPrompt = REGEN_PROMPTS[field];
  if (!regenPrompt) return res.status(400).json({ error: `unknown field: ${field}` });

  try {
    const context = `${buildUserContent(article)}\n\nCURRENT ANALYSIS CONTEXT:\n${JSON.stringify(currentAnalysis || {}, null, 2)}\n\nTASK: ${regenPrompt}`;
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: CLAUDE_HEADERS,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: field === 'hook_variants' ? 800 : 400,
        system: SYSTEM_MSG,
        messages: [{ role: 'user', content: context }],
      }),
    });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const data = await r.json();
    let text = data.content[0].text.replace(/```json|```/g, '').trim();
    let value;
    if (field === 'hook_variants') {
      try { value = JSON.parse(text); }
      catch { value = JSON.parse(jsonrepair(text)); }
    } else {
      value = text;
    }
    res.json({ field, value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Make webhook proxy (avoids CORS)
app.post('/export-make', async (req, res) => {
  const { webhookUrl, payload } = req.body;
  if (!webhookUrl?.startsWith('https://hook.')) {
    return res.status(400).json({ error: 'Invalid webhook URL — must start with https://hook.' });
  }
  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    res.json({ ok: r.ok, status: r.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// CS2 Veto tool
app.get('/veto', (_, res) => res.sendFile(join(__dirname, 'public', 'veto.html')));

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  NODX MEDIA`);
  console.log(`  ─────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Ctrl+C to stop\n`);
});
