import { Injectable } from '@nestjs/common';
import { MongooseModuleOptions, MongooseOptionsFactory } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MongooseConfigService implements MongooseOptionsFactory {
  constructor(private readonly configService: ConfigService) {}
  createMongooseOptions(): MongooseModuleOptions {
    const monoUri = this.configService.get<string>('MONGO_URI');
    if (monoUri) {
      return { uri: monoUri };
    }
    return {
      uri: this.configService.getOrThrow('MONGODB_URL'),
      dbName: this.configService.getOrThrow('MONGODB_NAME'),
      ssl: true,
      rejectUnauthorized: false,
    };
  }
}
