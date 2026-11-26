import { Module } from '@nestjs/common';
import { VncController } from './vnc.controller';

@Module({
  controllers: [VncController],
})
export class VncModule {}
