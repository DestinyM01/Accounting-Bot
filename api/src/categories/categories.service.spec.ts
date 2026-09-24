import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CustomCategory } from '../shared/schemas/custom-category.schema';

// list() maps each custom row through `_id.toString()`, so the fixture needs
// an _id even though only name/color/emoji matter for assertValid.
const mockModel: any = {
  find: jest.fn(function () { return this; }),
  lean: jest.fn().mockResolvedValue([{ _id: 'c1', name: 'Gym', color: '#000', emoji: 'x' }]),
};

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.BOSS_USER_ID = '1';
    mockModel.lean.mockResolvedValue([{ _id: 'c1', name: 'Gym', color: '#000', emoji: 'x' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getModelToken(CustomCategory.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<CategoriesService>(CategoriesService);
  });

  describe('assertValid', () => {
    it('passes for a built-in category', async () => {
      await expect(service.assertValid('food')).resolves.toBeUndefined();
    });

    it('passes for an active custom category', async () => {
      await expect(service.assertValid('Gym')).resolves.toBeUndefined();
    });

    it('rejects an unknown category', async () => {
      await expect(service.assertValid('nope')).rejects.toThrow(BadRequestException);
      await expect(service.assertValid('nope')).rejects.toThrow(/unknown category: nope/);
    });

    it('rejects the wrong case: names are stored verbatim', async () => {
      await expect(service.assertValid('gym')).rejects.toThrow(BadRequestException);
    });
  });
});
