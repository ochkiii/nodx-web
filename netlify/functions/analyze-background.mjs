// Background function: Netlify replies 202 to the caller right away and lets
// this run for up to 15 minutes, so the Claude call isn't cut off at 10s.
// The result is written to Netlify Blobs and picked up by analyze-result.
import { getStore } from '@netlify/blobs';
import { runAnalysis } from '../../server.js';

const JOB_ID_RE = /^[0-9a-f-]{36}$/i;

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { return; }
  const { jobId, article } = body || {};
  if (!JOB_ID_RE.test(jobId || '') || !article?.bodyText) return;

  const store = getStore({ name: 'analyses', consistency: 'strong' });
  await store.setJSON(jobId, { status: 'pending', createdAt: Date.now() });
  try {
    const analysis = await runAnalysis(article);
    await store.setJSON(jobId, { status: 'done', article, analysis });
  } catch (err) {
    console.error(err);
    await store.setJSON(jobId, { status: 'error', error: err.message });
  }
};
