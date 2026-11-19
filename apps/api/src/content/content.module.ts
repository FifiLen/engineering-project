import { Global, Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { CompanyService, COMPANY_PROFILE } from './company.service.js';
import { ContentPublisher } from './content-publisher.service.js';
import { ContentTextsService } from './content-texts.service.js';
import {
  CompanyController,
  ContentBlocksController,
  ContentSectionsController,
  FaqCategoriesController,
  FaqItemsController,
  MediaController,
  NewsController,
} from './content.controllers.js';
import { FaqService } from './faq.service.js';
import { MediaService } from './media.service.js';
import { NewsService } from './news.service.js';
import { PublicContentController, PublicMediaController } from './public-content.controller.js';
import { PublicContentService } from './public-content.service.js';
import { SectionsService } from './sections.service.js';

/**
 * Moduł Treści (iteracja 7, ADR 0062–0065): sekcje z rejestru, FAQ, aktualności, biblioteka mediów, dane firmy
 * i publiczne odczyty strony i aplikacji. Globalny, bo port danych firmy (`COMPANY_PROFILE`) woła moduł Płatności
 * przy wystawieniu paragonu, a odświeżenie strony (`ContentPublisher`) planują zmiany cennika i floty.
 */
@Global()
@Module({
  imports: [FilesModule],
  controllers: [
    ContentBlocksController,
    ContentSectionsController,
    FaqItemsController,
    FaqCategoriesController,
    NewsController,
    MediaController,
    CompanyController,
    PublicContentController,
    PublicMediaController,
  ],
  providers: [
    ContentPublisher,
    CompanyService,
    { provide: COMPANY_PROFILE, useExisting: CompanyService },
    SectionsService,
    FaqService,
    NewsService,
    MediaService,
    PublicContentService,
    ContentTextsService,
  ],
  exports: [ContentPublisher, CompanyService, COMPANY_PROFILE, ContentTextsService],
})
export class ContentModule {}
