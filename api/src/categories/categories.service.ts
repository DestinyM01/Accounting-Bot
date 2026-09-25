import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CustomCategory } from '../shared/schemas/custom-category.schema';
import { CategoryReferencesService, NO_USAGE, totalUses } from './category-references.service';
import { BUILT_IN_NAMES, EMOJIS, PALETTE, isKnownEmoji, isPaletteColor, nameError, normalizeName } from './category-rules';
import { Category } from '../shared/schemas/category.enum';

const BUILT_IN = [
  { name: 'food',          color: '#10e5a0', emoji: '🍔' },
  { name: 'transport',     color: '#fb923c', emoji: '🚗' },
  { name: 'housing',       color: '#38bdf8', emoji: '🏠' },
  { name: 'health',        color: '#a78bfa', emoji: '💊' },
  { name: 'entertainment', color: '#f472b6', emoji: '🎮' },
  { name: 'salary',        color: '#10e5a0', emoji: '💼' },
  { name: 'savings',       color: '#34d399', emoji: '💰' },
  { name: 'other',         color: '#94a3b8', emoji: '📦' },
  { name: 'cash',          color: '#84cc16', emoji: '💵' },
];

export interface CategoryInput {
  name?: unknown;
  emoji?: unknown;
  color?: unknown;
}

type Pending = { from: string; to: string };

@Injectable()
export class CategoriesService implements OnModuleInit {
  private readonly logger = new Logger(CategoriesService.name);
  private readonly userId = parseInt(process.env.BOSS_USER_ID || '0', 10);

  constructor(
    @InjectModel(CustomCategory.name) private readonly model: Model<CustomCategory>,
    private readonly refs: CategoryReferencesService,
  ) {}

  onModuleInit(): void {
    // Mongoose swallows an index-build failure; the $init promise is cached, so this sees the same result.
    this.model.init().catch((err) =>
      this.logger.error(
        'Could not build the unique index on active category names; two active categories probably share a name. Delete one on the Categories page and restart.',
        err instanceof Error ? err.stack : String(err),
      ),
    );
  }

  /** Built-ins plus active custom categories: what every picker offers. */
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

  /** Rejects a category that is neither built-in nor an active custom one. Exact, case-sensitive: names are stored verbatim. */
  async assertValid(category: string): Promise<void> {
    const allowed = (await this.list()).map((c) => c.name);
    if (!allowed.includes(category)) throw new BadRequestException(`unknown category: ${category}`);
  }

  /** Everything the Categories page shows: every category with its usage, and the options for new ones. */
  async overview() {
    const [custom, usage] = await Promise.all([
      this.model.find({ userId: this.userId, $or: [{ active: true }, { pending: { $ne: null } }] }).sort({ name: 1 }).lean(),
      this.refs.usage(),
    ]);
    const usageOf = (name: string) => ({ ...(usage.get(name) ?? NO_USAGE) });
    return {
      categories: [
        ...BUILT_IN.map((c) => ({
          id: null, name: c.name, emoji: c.emoji, color: c.color, isBuiltIn: true, active: true,
          usage: usageOf(c.name), pending: null,
        })),
        ...custom.map((c) => ({
          id: String(c._id), name: c.name, emoji: c.emoji, color: c.color, isBuiltIn: false, active: c.active,
          // A legacy custom category named like a built-in shares that name's data with the
          // built-in: its own row shows no usage, and remove() hides it without moving anything.
          usage: BUILT_IN_NAMES.includes(c.name) ? { ...NO_USAGE } : usageOf(c.name),
          pending: c.pending ?? null,
        })),
      ],
      palette: PALETTE,
      emojis: EMOJIS,
    };
  }

  async create(input: CategoryInput): Promise<{ id: string }> {
    const name = normalizeName(input?.name);
    const invalid = nameError(name);
    if (invalid) throw new BadRequestException(invalid);
    if (!isKnownEmoji(input?.emoji)) throw new BadRequestException('Choose one of the offered emoji');
    if (!isPaletteColor(input?.color)) throw new BadRequestException('Choose one of the offered colours');
    const taken = `You already have a category called ${name}`;
    await this.assertNameFree(name, taken);

    // A name deleted earlier comes back as the same record, never a duplicate.
    const revived = await this.claimName(
      this.model.findOneAndUpdate(
        { userId: this.userId, name, active: false, pending: null },
        { $set: { active: true, emoji: input.emoji, color: input.color } },
        { sort: { _id: -1 }, new: true },
      ),
      taken,
    );
    if (revived) return { id: String(revived._id) };

    const created = await this.claimName(
      this.model.create({ userId: this.userId, name, emoji: input.emoji, color: input.color, active: true, pending: null }),
      taken,
    );
    return { id: String(created._id) };
  }

  /** Emoji and colour change in place; a new name is a rename that every reference follows. */
  async update(id: string, input: CategoryInput): Promise<{ id: string }> {
    const cat = await this.findEditable(id);

    const set: Record<string, unknown> = {};
    if (input?.emoji !== undefined) {
      if (!isKnownEmoji(input.emoji)) throw new BadRequestException('Choose one of the offered emoji');
      set.emoji = input.emoji;
    }
    if (input?.color !== undefined) {
      if (!isPaletteColor(input.color)) throw new BadRequestException('Choose one of the offered colours');
      set.color = input.color;
    }

    const to = input?.name !== undefined ? normalizeName(input.name) : cat.name;
    if (to === cat.name) {
      if (Object.keys(set).length > 0) await this.model.updateOne({ _id: cat._id, userId: this.userId }, { $set: set });
      return { id: String(cat._id) };
    }

    if (BUILT_IN_NAMES.includes(cat.name)) {
      throw new BadRequestException(`${cat.name} shares its name with a built-in category and can't be renamed`);
    }
    const invalid = nameError(to);
    if (invalid) throw new BadRequestException(invalid);
    const taken = `${to} already exists — delete ${cat.name} and move it there to merge`;
    await this.assertNameFree(to, taken);

    // The rename and the reservation of the old name are one write.
    const pending: Pending = { from: cat.name, to };
    const claimed = await this.claimName(
      this.model.findOneAndUpdate(
        { _id: cat._id, userId: this.userId, name: cat.name, active: true, pending: null },
        { $set: { ...set, name: to, pending } },
      ),
      taken,
    );
    if (!claimed) throw new ConflictException(`${cat.name} changed meanwhile — reload and try again`);
    await this.completeMove(cat._id, pending);
    return { id: String(cat._id) };
  }

  /** Deletes a custom category, moving everything that uses it to `moveTo` (required while it is in use). */
  async remove(id: string, moveTo?: string): Promise<void> {
    const cat = await this.findEditable(id);
    // A legacy custom category carrying a built-in's name (the old api allowed one) shares
    // that name's data with the built-in: never move it, only hide the record.
    const sharesBuiltIn = BUILT_IN_NAMES.includes(cat.name);
    if (sharesBuiltIn && moveTo) {
      throw new BadRequestException(`${cat.name} shares its name with a built-in category; delete it without moving`);
    }
    const usage = sharesBuiltIn ? NO_USAGE : (await this.refs.usage()).get(cat.name) ?? NO_USAGE;
    const inUse = totalUses(usage) > 0;

    let pending: Pending | null = null;
    if (moveTo) {
      if (moveTo === cat.name) throw new BadRequestException('Choose a different category to move it to');
      if (moveTo === Category.CASH && usage.cashItems > 0) {
        throw new BadRequestException("Cash items can't move into cash — pick where the cash went");
      }
      const active = (await this.list()).map((c) => c.name);
      if (!active.includes(moveTo)) throw new BadRequestException(`${moveTo} is not an active category`);
      pending = { from: cat.name, to: moveTo };
    } else if (inUse) {
      throw new BadRequestException(`${cat.name} is in use — choose a category to move it to`);
    }

    // Hiding it and reserving its name are one write: from here nothing new can pick it.
    // Pinning the name guards against a rename finishing in another tab between the read
    // above and this write, which would otherwise record a move from a name that no longer
    // holds the data.
    const claimed = await this.model.findOneAndUpdate(
      { _id: cat._id, userId: this.userId, name: cat.name, active: true, pending: null },
      { $set: { active: false, pending } },
    );
    if (!claimed) throw new ConflictException(`${cat.name} changed meanwhile — reload and try again`);
    if (pending) await this.completeMove(cat._id, pending);
  }

  /** Re-runs an interrupted move. */
  async finish(id: string): Promise<{ id: string }> {
    const cat = await this.findOwn(id);
    if (!cat.pending) throw new NotFoundException(`${cat.name} has no unfinished move`);
    await this.completeMove(cat._id, cat.pending);
    return { id: String(cat._id) };
  }

  private async completeMove(id: unknown, pending: Pending): Promise<void> {
    await this.refs.migrate(pending.from, pending.to);
    // Only clear the move this call finished: a newer one may have replaced it meanwhile.
    await this.model.updateOne({ _id: id, 'pending.from': pending.from, 'pending.to': pending.to }, { $set: { pending: null } });
  }

  private async findOwn(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('No such category');
    const cat = await this.model.findOne({ _id: id, userId: this.userId }).lean();
    if (!cat) throw new NotFoundException('No such category');
    return cat;
  }

  private async findEditable(id: string) {
    const cat = await this.findOwn(id);
    if (!cat.active) throw new ConflictException(`${cat.name} was deleted`);
    if (cat.pending) throw new ConflictException(`${cat.name} is being moved — finish that move first`);
    // A category an unfinished move is still moving data into must stay as it is,
    // or finishing that move would put the rest of the data under a dead name.
    const incoming = await this.model.findOne({ userId: this.userId, 'pending.to': cat.name }).lean();
    if (incoming) {
      throw new ConflictException(`${incoming.pending.from} is still being moved into ${cat.name} — finish that move first`);
    }
    return cat;
  }

  /** The unique index on active names caught a race assertNameFree couldn't see: answer as it would have. */
  private async claimName<T>(write: PromiseLike<T>, takenMessage: string): Promise<T> {
    try {
      return await write;
    } catch (err) {
      if ((err as { code?: number } | null)?.code === 11000) throw new ConflictException(takenMessage);
      throw err;
    }
  }

  /** Refuses a name held by an active custom category, or one an unfinished move is still moving away from. */
  private async assertNameFree(name: string, takenMessage: string): Promise<void> {
    const clash = await this.model
      .findOne({ userId: this.userId, $or: [{ name, active: true }, { 'pending.from': name }] })
      .lean();
    if (!clash) return;
    if (clash.active && clash.name === name) throw new ConflictException(takenMessage);
    throw new ConflictException(`${name} is still being moved — finish that move first`);
  }
}
