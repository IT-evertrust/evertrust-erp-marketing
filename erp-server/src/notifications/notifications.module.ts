import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// In-app notification feed. GET/PATCH are JWT (the bell UI); POST is machine. DB is
// global; the service consumes it. ArsenalTokenGuard gates the @Public() POST route.
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, ArsenalTokenGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
