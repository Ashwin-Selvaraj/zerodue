import { SetMetadata } from '@nestjs/common';

export const DEVICE_ACCESS_KEY = 'deviceAccess';

/**
 * Lets a paired phone's device token call this route as well as a signed-in user. Everything else
 * rejects device tokens, so a lost phone cannot read financial history.
 */
export const DeviceAccess = () => SetMetadata(DEVICE_ACCESS_KEY, true);
