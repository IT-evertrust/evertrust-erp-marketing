import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppConfigModule } from './config/config.module';
import { LoggerModule } from './logger/logger.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { NichesModule } from './niches/niches.module';
import { IndustriesModule } from './industries/industries.module';
import { WorkflowConfigModule } from './arsenal/workflow-config.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ArsenalModule } from './arsenal/arsenal.module';
import { ProspectsModule } from './prospects/prospects.module';
import { OutreachModule } from './outreach/outreach.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LeadsModule } from './leads/leads.module';
import { MeetingsModule } from './meetings/meetings.module';
import { GoogleModule } from './google/google.module';
import { EngageModule } from './engage/engage.module';
import { ReachModule } from './reach/reach.module';
import { ActivateModule } from './activate/activate.module';
import { OverviewModule } from './overview/overview.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { AuditInterceptor } from './common/audit.interceptor';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    DbModule,
    HealthModule,
    AuthModule,
    NichesModule,
    IndustriesModule,
    WorkflowConfigModule,
    CampaignsModule,
    ArsenalModule,
    ProspectsModule,
    OutreachModule,
    NotificationsModule,
    LeadsModule,
    MeetingsModule,
    GoogleModule,
    EngageModule,
    ReachModule,
    ActivateModule,
    OverviewModule,
  ],
  providers: [
    // Zod DTOs are the contract: validate every request body/param/query.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Global auth. ORDER MATTERS: authenticate first (populate req.user)...
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // ...then authorize by permission. PermissionsGuard is the single RBAC
    // authority: it expands the role -> permissions and enforces
    // @RequirePermissions(...).
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Audit successful mutations (Workflow -> API -> DB -> Audit).
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
