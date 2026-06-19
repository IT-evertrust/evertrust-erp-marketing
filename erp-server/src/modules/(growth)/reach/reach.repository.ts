import { Injectable } from '@nestjs/common';

import type { CreateAimDto } from './dto/create-aim.dto';
import type { ReachAim, ReachLead } from './reach.model';

@Injectable()
export class ReachRepository {
  private aims: ReachAim[] = [];
  private leads: ReachLead[] = [];

  createAim(dto: CreateAimDto): ReachAim {
    const now = new Date().toISOString();

    const aim: ReachAim = {
      id: crypto.randomUUID(),
      name: dto.name,
      niche: dto.niche,
      region: dto.region,
      segment: dto.segment,
      source: dto.source,
      status: 'READY',
      companies: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.aims.unshift(aim);

    return aim;
  }

  findAims(): ReachAim[] {
    return this.aims;
  }

  findAimById(aimId: string): ReachAim | undefined {
    return this.aims.find((aim) => aim.id === aimId);
  }

  startAim(aimId: string): ReachAim | undefined {
    const aim = this.findAimById(aimId);

    if (!aim) return undefined;

    aim.status = 'RUNNING';
    aim.updatedAt = new Date().toISOString();

    return aim;
  }

  findLeadsByAimId(aimId: string): ReachLead[] {
    return this.leads.filter((lead) => lead.aimId === aimId);
  }
}