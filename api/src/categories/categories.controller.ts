import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CategoriesService, CategoryInput } from './categories.service';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  list() {
    return this.categoriesService.list();
  }

  @Get('overview')
  overview() {
    return this.categoriesService.overview();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: CategoryInput) {
    return this.categoriesService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: CategoryInput) {
    return this.categoriesService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Query('moveTo') moveTo?: string) {
    await this.categoriesService.remove(id, moveTo);
  }

  @Post(':id/finish')
  @HttpCode(200)
  finish(@Param('id') id: string) {
    return this.categoriesService.finish(id);
  }
}
