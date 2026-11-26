import { Module } from '@nestjs/common';
import { VncController } from './vnc.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VncController],
})
export class VncModule {}
