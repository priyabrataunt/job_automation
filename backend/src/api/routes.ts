import { FastifyInstance } from 'fastify';
import db from '../db/database';
import { runCollection, isCollectionRunning } from '../orchestrator';

export async function registerRoutes(app: FastifyInstance): Promise<void> {

  // GET /api/jobs
  app.get('/api/jobs', async (request, reply) => {
    const {
      status,
      ats_source,
      job_type,
      remote,
      search,
      hours,
      limit = '50',
      offset = '0',
    } = request.query as Record<string, string>;

    const conditions: string[] = [];
    const params: any[] = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (ats_source) { conditions.push('ats_source = ?'); params.push(ats_source); }
    if (job_type) { conditions.push('job_type = ?'); params.push(job_type); }
    if (remote !== undefined && remote !== '') {
      conditions.push('remote = ?');
      params.push(remote === 'true' || remote === '1' ? 1 : 0);
    }
    if (search) {
      conditions.push('(title LIKE ? OR company LIKE ? OR description_snippet LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q);
    }
    if (hours) {
      const cutoff = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000).toISOString();
      conditions.push('first_seen_at >= ?');
      params.push(cutoff);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;

    const total = (db.prepare(`SELECT COUNT(*) as count FROM jobs ${where}`).get(...params) as any).count;
    const jobs = db.prepare(`SELECT * FROM jobs ${where} ORDER BY first_seen_at DESC LIMIT ? OFFSET ?`).all(...params, lim, off);

    return reply.send({ jobs, total });
  });

  // PATCH /api/jobs/:id/status
  app.patch('/api/jobs/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    const valid = ['new', 'saved', 'applied', 'rejected', 'archived'];
    if (!valid.includes(status)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });
    }

    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, parseInt(id));
    return reply.send({ ok: true });
  });

  // GET /api/stats
  app.get('/api/stats', async (_request, reply) => {
    const statusCounts = db.prepare(`SELECT status, COUNT(*) as count FROM jobs GROUP BY status`).all() as any[];
    const sourceCounts = db.prepare(`SELECT ats_source, COUNT(*) as count FROM jobs GROUP BY ats_source`).all() as any[];
    const typeCounts = db.prepare(`SELECT job_type, COUNT(*) as count FROM jobs GROUP BY job_type`).all() as any[];

    const now = new Date();
    const h6 = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const new6h = (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE first_seen_at >= ?`).get(h6) as any).c;
    const new24h = (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE first_seen_at >= ?`).get(h24) as any).c;

    const lastRun = db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 1`).get();

    return reply.send({
      by_status: Object.fromEntries(statusCounts.map(r => [r.status, r.count])),
      by_source: Object.fromEntries(sourceCounts.map(r => [r.ats_source, r.count])),
      by_type: Object.fromEntries(typeCounts.map(r => [r.job_type, r.count])),
      new_6h: new6h,
      new_24h: new24h,
      last_run: lastRun || null,
    });
  });

  // GET /api/runs
  app.get('/api/runs', async (_request, reply) => {
    const runs = db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 10`).all();
    return reply.send({ runs });
  });

  // POST /api/collect
  app.post('/api/collect', async (request, reply) => {
    const { hours = '24' } = request.query as { hours?: string };
    const hoursBack = parseInt(hours) || 24;

    // Run in background
    setImmediate(() => {
      runCollection(hoursBack).catch(err => console.error('[API] collect error:', err));
    });

    return reply.send({ message: `Collection started (${hoursBack}h back)` });
  });

  // GET /api/collect/status
  app.get('/api/collect/status', async (_request, reply) => {
    return reply.send({ running: isCollectionRunning() });
  });

  // GET /health
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });
}
