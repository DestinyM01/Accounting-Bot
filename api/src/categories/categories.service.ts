import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomCategory } from '../shared/schemas/custom-category.schema';

const BUILT_IN = [
  { name: 'food',          color: '#10e5a0', emoji: '🍔' },
  { name: 'transport',     color: '#fb923c', emoji: '🚗' },
  { name: 'housing',       color: '#38bdf8', emoji: '🏠' },
  { name: 'health',        color: '#a78bfa', emoji: '💊' },
  { name: 'entertainment', color: '#f472b6', emoji: '🎮' },
  { name: 'salary',        color: '#10e5a0', emoji: '💼' },
  { name: 'savings',       color: '#34d399', emoji: '💰' },
  { name: 'other',         color: '#94a3b8', emoji: '📦' },
];

@Injectable()
export class CategoriesService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(CustomCategory.name) private readonly model: Model<CustomCategory>,
  ) {}

  async list() {
    const custom = await this.model.find({ userId: this.userId, active: true }).lean();
    return [
      ...BUILT_IN.map((c) => ({ ...c, isBuiltIn: true, id: null })),
      ...custom.map((c) => ({
        name:      c.name,
        color:     c.color,
        emoji:     c.emoji,
        isBuiltIn: false,
        id:        (c as any)._id.toString(),
      })),
    ];
  }

  async create(name: string, emoji: string, color: string): Promise<void> {
    await this.model.create({ userId: this.userId, name, emoji, color, active: true });
  }

  async delete(id: string): Promise<void> {
    await this.model.findOneAndUpdate({ _id: id, userId: this.userId }, { active: false });
  }
}
