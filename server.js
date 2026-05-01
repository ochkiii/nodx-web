// NODX Web — Article Analyzer
// node server.js → http://localhost:3000

import express from 'express';
import { load as cheerioLoad } from 'cheerio';
import { jsonrepair } from 'jsonrepair';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env locally — on Railway env vars are injected directly
try { dotenv.config({ path: join(__dirname, '../.env') }); } catch (_) {}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const API_URL  = 'https://api.anthropic.com/v1/messages';
const MODEL    = 'claude-sonnet-4-6';
const API_KEY  = process.env.ANTHROPIC_API_KEY;

// ── Article scraper ───────────────────────────────────────────────
async function fetchArticle(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerioLoad(html);

  // Meta
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text() ||
    $('h1').first().text() ||
    '';

  const description =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    '';

  const ogImage =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';

  const author =
    $('meta[name="author"]').attr('content') ||
    $('[rel="author"]').first().text() ||
    $('[class*="author"]').first().text().trim().slice(0, 60) ||
    '';

  const datePublished =
    $('meta[property="article:published_time"]').attr('content') ||
    $('time').first().attr('datetime') ||
    '';

  const siteName =
    $('meta[property="og:site_name"]').attr('content') ||
    new URL(url).hostname.replace('www.', '');

  // Body text — try article/main first, fallback to body
  let bodyText = '';
  const articleEl = $('article, [role="main"], main, .post-content, .entry-content, .article-body, .story-body').first();
  const source = articleEl.length ? articleEl : $('body');

  source.find('p').each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 40) bodyText += t + '\n\n';
  });

  // Fallback: grab all headings + paragraphs
  if (bodyText.length < 200) {
    $('h2, h3, p').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 20) bodyText += t + '\n\n';
    });
  }

  bodyText = bodyText.slice(0, 8000); // cap for Claude context

  // Images
  const images = [];
  if (ogImage) images.push({ src: ogImage, alt: title, type: 'og' });

  source.find('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    const alt = $(el).attr('alt') || '';
    if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar')) {
      if (!images.find(i => i.src === src)) {
        images.push({ src, alt, type: 'inline' });
      }
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

// ── Claude analysis ───────────────────────────────────────────────
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

REEL SCRIPT — write a complete 45–60 second spoken script:
  hook: best hook from the variants above. 1-2 sentences. Stops scroll.
  setup: why this matters right now. 2-3 sentences. Conversational.
  conflict: the tension or what is broken. 2-3 sentences.
  resolution: what shifts, one concrete thing to know or do. 3-4 sentences.
  close: one sentence challenge or CTA. Direct address. No hedging.
  shot_tags: 3-5 production notes using these formats only:
    "talking head — [describe angle or energy]"
    "b-roll: [specific visual]"
    "screen record: [specific action]"
    "text overlay: [exact words]"
Write actual spoken words. Not descriptions of what to say.

CAROUSEL STRUCTURE — always 4 to 8 slides, never fewer than 4:
One idea per slide. Each slide save-worthy on its own.
  Slide 1 — HOOK: Contrarian or tension-based. Not what happened — what it means at maximum contrast.
  Slide 2 — SETUP: Why now. Editorial framing, not background.
  Slides 3–5 — TEACH: One arguable insight per slide. A single claim, not a list.
  Slide 6 — REFRAME (if warranted): Second-order effect nobody is writing about.
  Slide 7 — MISS (optional): What the coverage gets wrong.
  Last slide — CLOSE: Thesis restated as challenge. One sentence. Direct address.
SLIDE TYPES: HOOK | SETUP | TEACH | REFRAME | MISS | CLOSE

STORY SEQUENCE — 6 Instagram Story frames:
  Frame 1 — HOOK: Question or claim that makes someone tap forward
  Frame 2 — CONTEXT: The condition that makes this relevant now
  Frame 3 — INSIGHT: The single most useful thing to know
  Frame 4 — PROOF: One specific example, stat, or case
  Frame 5 — SHIFT: What this changes for the viewer personally
  Frame 6 — CTA: One specific action, question, or challenge
Each frame: 1-2 lines of text maximum. Written as if it is the only thing on screen.

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
  "reel_script": {
    "hook": "spoken words",
    "setup": "spoken words",
    "conflict": "spoken words",
    "resolution": "spoken words",
    "close": "spoken words",
    "shot_tags": ["talking head — direct address", "b-roll: specific visual"]
  },
  "slides": [
    {
      "slide": 1,
      "type": "HOOK",
      "headline": "max 10 words, argument not summary",
      "body": "1-2 sentences. One idea only.",
      "suggested_image_index": null,
      "copy_text": "headline + body as copy-pasteable slide text"
    }
  ],
  "story_sequence": [
    { "frame": 1, "type": "HOOK",    "text": "1-2 lines max, as it appears on screen" },
    { "frame": 2, "type": "CONTEXT", "text": "..." },
    { "frame": 3, "type": "INSIGHT", "text": "..." },
    { "frame": 4, "type": "PROOF",   "text": "..." },
    { "frame": 5, "type": "SHIFT",   "text": "..." },
    { "frame": 6, "type": "CTA",     "text": "..." }
  ],
  "threads_post": "1-3 sentences. Blunt. Opinionated. Publish before carousel.",
  "best_line": "The single most quotable line from all output",
  "caption": "Full Instagram caption: nodx_take restated + 1-2 sentence expansion + 'Send this to [specific person]' + series hashtag + 2-4 niche hashtags"
}
No preamble. No explanation. JSON only.`;

async function analyzeWithClaude(article, retries = 2) {
  const imageList = article.images.map((img, i) => `[${i}] ${img.alt || 'image'}: ${img.src}`).join('\n');

  const userContent = `ARTICLE URL: ${article.url}
SOURCE: ${article.siteName}
TITLE: ${article.title}
DESCRIPTION: ${article.description}
AUTHOR: ${article.author}
DATE: ${article.datePublished}

IMAGES AVAILABLE:
${imageList || 'None extracted'}

ARTICLE TEXT:
${article.bodyText}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4500,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userContent }],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`API ${res.status}: ${err}`);
      }

      const data = await res.json();
      const text = data.content[0].text.replace(/```json|```/g, '').trim();
      try { return JSON.parse(text); }
      catch { return JSON.parse(jsonrepair(text)); }

    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

// ── Routes ────────────────────────────────────────────────────────

// Step 1: scrape article only (used by two-step UI flow)
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

// Step 2 (or combined): analyze — accepts pre-fetched article or url
app.post('/analyze', async (req, res) => {
  const { url, article: providedArticle } = req.body;
  if (!url && !providedArticle) return res.status(400).json({ error: 'url or article required' });

  try {
    const article = providedArticle || await fetchArticle(url);
    const analysis = await analyzeWithClaude(article);
    res.json({ article, analysis });
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
  console.log(`\n  NODX MEDIA ANALYZER`);
  console.log(`  ─────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Ctrl+C to stop\n`);
});
