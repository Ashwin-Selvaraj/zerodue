import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { AppConfig } from '../config/app-config';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  reminderId: string;
  occurrenceId: string | null;
  /** Where tapping the notification goes. */
  url: string;
  actions: { action: string; title: string }[];
}

/** 'gone' means the browser has dropped this subscription and it should be forgotten. */
export type PushResult = 'sent' | 'gone' | 'failed';

/** Sends Web Push messages. Replaced in tests; does nothing when VAPID keys are not configured. */
@Injectable()
export class PushSender {
  private readonly logger = new Logger(PushSender.name);

  constructor(private readonly config: AppConfig) {
    const vapid = config.vapid;
    if (vapid) webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  get enabled(): boolean {
    return this.config.vapid !== null;
  }

  get publicKey(): string | null {
    return this.config.vapid?.publicKey ?? null;
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    if (!this.enabled) return 'failed';
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
        { TTL: 60 * 60 * 24 },
      );
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      this.logger.warn(`Push failed (${status ?? 'no status'})`);
      return 'failed';
    }
  }
}
