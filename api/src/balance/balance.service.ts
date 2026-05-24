import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Balance } from '../shared/schemas/balance.schema';

@Injectable()
export class BalanceService {
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(@InjectModel(Balance.name) private balanceModel: Model<Balance>) {}

  async get() {
    return this.balanceModel
      .findOne({ userId: this.userId })
      .select('balance isPremium lastActivity language')
      .lean();
  }
}
