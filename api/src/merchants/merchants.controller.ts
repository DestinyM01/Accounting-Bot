import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { MerchantMemoryService } from './merchant-memory.service';

interface AddMerchantBody {
  name?: unknown;
  category?: unknown;
}

interface ChangeMerchantBody {
  category?: unknown;
}

/** The Merchants page: see, add, change and forget the merchants the app files on its own. */
@Controller('merchants')
@UseGuards(JwtAuthGuard)
export class MerchantsController {
  constructor(private readonly memory: MerchantMemoryService) {}

  @Get()
  list() {
    return this.memory.list();
  }

  @Get('match')
  match(@Query('name') name?: unknown) {
    return this.memory.match(name);
  }

  @Post()
  @HttpCode(201)
  add(@Body() body?: AddMerchantBody) {
    return this.memory.add(body?.name, body?.category);
  }

  @Patch(':id')
  @HttpCode(200)
  change(@Param('id') id: string, @Body() body?: ChangeMerchantBody) {
    return this.memory.change(id, body?.category);
  }

  @Delete(':id')
  @HttpCode(204)
  async forget(@Param('id') id: string): Promise<void> {
    await this.memory.forget(id);
  }
}
