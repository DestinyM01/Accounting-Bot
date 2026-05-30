import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomCategory } from '../mongodb/schemas/custom-category.schema';

@Injectable()
export class CustomCategoryService {
  private readonly logger = new Logger(CustomCategoryService.name);

  constructor(
    @InjectModel('CustomCategory')
    private readonly model: Model<CustomCategory>,
  ) {}

  async createCategory(
    userId: number,
    name: string,
    emoji: string,
    color: string,
  ): Promise<CustomCategory> {
    this.logger.log(`User ${userId} creating category: ${name}`);
    return this.model.create({ userId, name, emoji, color, active: true });
  }

  async listCategories(userId: number): Promise<CustomCategory[]> {
    return this.model.find({ userId, active: true }).sort({ name: 1 }).exec();
  }

  async deleteCategory(userId: number, id: string): Promise<void> {
    await this.model.findOneAndUpdate({ _id: id, userId }, { active: false }).exec();
    this.logger.log(`User ${userId} deleted category ${id}`);
  }
}
