import { authResponseSchema, loginSchema, registerSchema } from '@zerodue/shared';
import { createZodDto } from 'nestjs-zod';

export class RegisterDto extends createZodDto(registerSchema) {}
export class LoginDto extends createZodDto(loginSchema) {}
export class AuthResponseDto extends createZodDto(authResponseSchema) {}
