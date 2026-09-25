import { BadGatewayException, ConflictException, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { IngestionService } from './ingestion.service';
import { IngestionStatusService, RunCounts } from './ingestion-status.service';

@Controller('ingestion')
@UseGuards(JwtAuthGuard)
export class IngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly statusService: IngestionStatusService,
  ) {}

  @Get('status')
  status() {
    return this.statusService.view(this.ingestion.isRunning);
  }

  /** Checks mail now: the same run the cron does, never overlapping it. */
  @Post('run')
  @HttpCode(200)
  async run(): Promise<RunCounts> {
    let counts: RunCounts | null;
    try {
      counts = await this.ingestion.runGuarded();
    } catch (err) {
      throw new BadGatewayException(`The check failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    }
    if (!counts) throw new ConflictException('A check is already running');
    return counts;
  }

  @Post('unreadable/:id/dismiss')
  @HttpCode(204)
  async dismiss(@Param('id') id: string): Promise<void> {
    await this.statusService.dismiss(id);
  }
}
