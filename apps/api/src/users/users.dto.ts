import { meResponseSchema, updateUserSettingsSchema, userSettingsSchema } from '@zerodue/shared';
import { createZodDto } from 'nestjs-zod';

export class MeResponseDto extends createZodDto(meResponseSchema) {}
export class UserSettingsResponseDto extends createZodDto(userSettingsSchema) {}
export class UpdateUserSettingsDto extends createZodDto(updateUserSettingsSchema) {}
