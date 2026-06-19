import { Injectable, NotFoundException } from '@nestjs/common';

import type { CreateAimDto } from './dto/create-aim.dto';
import { ReachRepository } from './reach.repository';

@Injectable()
export class ReachService {
  constructor(private readonly reachRepository: ReachRepository) {}

  createAim(dto: CreateAimDto) {
    return this.reachRepository.createAim(dto);
  }

  getAims() {
    return this.reachRepository.findAims();
  }

  getAim(aimId: string) {
    const aim = this.reachRepository.findAimById(aimId);

    if (!aim) {
      throw new NotFoundException('Aim not found');
    }

    return aim;
  }

  startAim(aimId: string) {
    const aim = this.reachRepository.startAim(aimId);

    if (!aim) {
      throw new NotFoundException('Aim not found');
    }

    // Later:
    // enqueue Python scraper / agent workflow here.

    return aim;
  }

  getAimLeads(aimId: string) {
    this.getAim(aimId);

    return this.reachRepository.findLeadsByAimId(aimId);
  }
}