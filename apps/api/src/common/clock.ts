import { Global, Injectable, Module } from '@nestjs/common';

/** The single source of "now", so tests can pin time (see assumption A4). */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class CommonModule {}
