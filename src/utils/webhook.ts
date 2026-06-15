import axios from 'axios';
import { LARAVEL_WEBHOOK_URL, CALLBACK_SECRET } from '../config';
import { logger } from './logger';

export async function triggerWebhook(tenantId: string, payload: any) {
  try {
    await axios.post(
      LARAVEL_WEBHOOK_URL,
      {
        tenantId,
        ...payload,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Callback-Secret': CALLBACK_SECRET,
        },
        timeout: 5000,
      }
    );
  } catch (err: any) {
    logger.error(`Webhook callback error for tenant ${tenantId}: ${err.message}`);
  }
}
