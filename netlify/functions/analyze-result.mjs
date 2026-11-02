// Polled by the frontend until the background analysis job finishes.
import { getStore } from '@netlify/blobs';

const JOB_ID_RE = /^[0-9a-f-]{36}$/i;

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!JOB_ID_RE.test(id)) return Response.json({ error: 'invalid id' }, { status: 400 });

  const store = getStore({ name: 'analyses', consistency: 'strong' });
  const job = await store.get(id, { type: 'json' });
  // Not written yet — the background function may still be starting up
  if (!job) return Response.json({ status: 'pending' });
  // Finished jobs are handed over once, then removed
  if (job.status !== 'pending') await store.delete(id);
  return Response.json(job);
};
