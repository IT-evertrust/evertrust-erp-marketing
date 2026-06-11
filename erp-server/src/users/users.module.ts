import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AdminController } from './admin.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, AdminController],
  providers: [UsersService],
})
export class UsersModule {}
