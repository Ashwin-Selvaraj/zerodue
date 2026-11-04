import { uuidSchema } from '@zerodue/shared';
import type { WriteContext } from '../records/records.service';

/** Header carrying the calling device's id, so writes can be attributed and not echoed back on pull. */
export const DEVICE_HEADER = 'x-device-id';

export function writeContext(header: string | undefined): WriteContext {
  return { deviceId: header && uuidSchema.safeParse(header).success ? header : null };
}
