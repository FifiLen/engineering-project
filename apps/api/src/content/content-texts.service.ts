import { type Database, DrizzleContentRepository } from '@hulajnogi/db';
import { markdownPlainText, parseMarkdown } from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../database/database.module.js';

/**
 * Port modułu Treści dla innych modułów (ADR 0062, ADR 0003): opublikowany blok sekcji jako zwykły tekst, np. tekst
 * naklejki z kodem QR z sekcji `admin.scooter-label` (ADR 0068), żeby nie był wpisany w kod.
 */
@Injectable()
export class ContentTextsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Nagłówek opublikowanej sekcji panelu (pozycja 0); brak publikacji daje puste pola. */
  async adminSection(key: string): Promise<{ title: string | null; body: string | null }> {
    const blocks = await new DrizzleContentRepository(this.db).publicBlocks('ADMIN');
    const header = blocks.find((block) => block.key === key && block.position === 0);
    return {
      title: header?.title ?? null,
      body: header?.bodyMd ? markdownPlainText(parseMarkdown(header.bodyMd, 'inline').blocks) : null,
    };
  }
}
