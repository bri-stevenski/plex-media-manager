/**
 * Notification service — sends alerts to Discord and/or Pushover.
 *
 * Both are purely optional. If the env vars aren't set the methods no-op.
 * Callers don't need to guard; this module handles it internally.
 */

import axios from 'axios';
import { getLogger } from '../config/logger.js';
import type { ShowGapReport } from '../services/missing-episodes.js';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? '';
const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN ?? '';
const PUSHOVER_USER = process.env.PUSHOVER_USER ?? '';

export interface NotifyOptions {
  /** Override channel for testing */
  discordUrl?: string;
  pushoverToken?: string;
  pushoverUser?: string;
}

async function postDiscord(url: string, payload: Record<string, any>): Promise<void> {
  await axios.post(url, payload, { timeout: 10_000 });
}

async function postPushover(
  token: string,
  user: string,
  title: string,
  message: string,
  priority = 0,
): Promise<void> {
  await axios.post(
    'https://api.pushover.net/1/messages.json',
    { token, user, title, message, priority },
    { timeout: 10_000 },
  );
}

/** Low-level: send a plain message to configured channels. */
export async function notify(
  title: string,
  message: string,
  opts: NotifyOptions = {},
): Promise<void> {
  const logger = getLogger();
  const discordUrl = opts.discordUrl ?? DISCORD_WEBHOOK_URL;
  const poToken = opts.pushoverToken ?? PUSHOVER_TOKEN;
  const poUser = opts.pushoverUser ?? PUSHOVER_USER;

  const tasks: Promise<void>[] = [];

  if (discordUrl) {
    tasks.push(
      postDiscord(discordUrl, {
        embeds: [{ title, description: message, color: 0x1db954 }],
      }).catch((err) => logger.warning('Discord notification failed', { error: err.message })),
    );
  }

  if (poToken && poUser) {
    tasks.push(
      postPushover(poToken, poUser, title, message).catch((err) =>
        logger.warning('Pushover notification failed', { error: err.message }),
      ),
    );
  }

  await Promise.all(tasks);
}

/** Notify that new media was added to the library. */
export async function notifyMediaAdded(
  items: { title: string; year?: number; type: 'movie' | 'tv' }[],
  opts: NotifyOptions = {},
): Promise<void> {
  if (items.length === 0) return;

  const lines = items.map((i) => {
    const label = i.type === 'movie' ? '🎬' : '📺';
    return `${label} **${i.title}**${i.year ? ` (${i.year})` : ''}`;
  });

  const title = `${items.length} item${items.length !== 1 ? 's' : ''} added to Plex`;
  const message = lines.join('\n');
  await notify(title, message, opts);
}

/** Notify about missing episodes found during a library scan. */
export async function notifyMissingEpisodes(
  reports: ShowGapReport[],
  opts: NotifyOptions = {},
): Promise<void> {
  const withGaps = reports.filter((r) => r.missing.length > 0);
  if (withGaps.length === 0) return;

  const totalMissing = withGaps.reduce((n, r) => n + r.missing.length, 0);
  const lines = withGaps.map(
    (r) => `**${r.showTitle}** — ${r.missing.length} episode${r.missing.length !== 1 ? 's' : ''} missing`,
  );

  const title = `Library gap report: ${totalMissing} missing episode${totalMissing !== 1 ? 's' : ''}`;
  const message = lines.join('\n');
  await notify(title, message, opts);
}

/** Notify about a processing error. */
export async function notifyError(
  context: string,
  error: string,
  opts: NotifyOptions = {},
): Promise<void> {
  await notify(`❌ plex-media-manager error: ${context}`, error, opts);
}

export function isNotifierConfigured(): boolean {
  return DISCORD_WEBHOOK_URL.length > 0 || (PUSHOVER_TOKEN.length > 0 && PUSHOVER_USER.length > 0);
}
