import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

/** Payment messages from the Android companion. */
@Module({ controllers: [IngestController], providers: [IngestService] })
export class IngestModule {}
