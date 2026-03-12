import webpush from 'web-push';
import db from './db/database';

// Initialize VAPID keys from env or generate them
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:priyabrata@example.com';

let vapidConfigured = false;

export function initPush(): void {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    console.log('[Push] VAPID configured');
  } else {
    console.log('[Push] VAPID keys not set — push disabled. Run: npx web-push generate-vapid-keys');
  }
}

export async function sendDigestPush(): Promise<void> {
  if (!vapidConfigured) return;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const stats = db.prepare(
    `SELECT COUNT(*) as total FROM jobs WHERE first_seen_at >= ?`
  ).get(cutoff) as { total: number };

  const topJob = db.prepare(
    `SELECT title, company FROM jobs WHERE first_seen_at >= ? ORDER BY relevance_score DESC LIMIT 1`
  ).get(cutoff) as { title: string; company: string } | undefined;

  if (stats.total === 0) return;

  const body = topJob
    ? `${stats.total} new jobs today! Top: ${topJob.title} at ${topJob.company}`
    : `${stats.total} new jobs posted in the last 24 hours`;

  const payload = JSON.stringify({
    title: '🔔 Daily Job Digest',
    body,
    url: '/',
  });

  const subscriptions = db.prepare('SELECT * FROM push_subscriptions').all() as {
    id: number; endpoint: string; keys_p256dh: string; keys_auth: string;
  }[];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        },
        payload,
      );
    } catch (err: any) {
      // Remove expired/invalid subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        console.log(`[Push] Removed expired subscription ${sub.id}`);
      } else {
        console.error(`[Push] Failed to send to ${sub.id}:`, err.message);
      }
    }
  }

  console.log(`[Push] Sent digest to ${subscriptions.length} subscriber(s)`);
}
