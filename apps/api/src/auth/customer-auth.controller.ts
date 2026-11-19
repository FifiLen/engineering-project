import {
  consentsAcceptSchema,
  otpRequestSchema,
  otpVerifySchema,
  profileUpdateSchema,
  refreshSchema,
  registrationSchema,
  type ConsentsAccept,
  type OtpRequest,
  type OtpVerify,
  type ProfileUpdate,
  type RefreshRequest,
  type Registration,
} from '@hulajnogi/shared';
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-query.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CurrentCustomer, CustomerAuth, Public, type CustomerPrincipal } from './decorators.js';

/** Logowanie klienta kodem SMS i sesje aplikacji (ADR 0019, ADR 0035). */
@ApiTags('aplikacja: konto')
@Controller()
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Public()
  @Post('auth/otp')
  @HttpCode(202)
  @ApiOperation({ summary: 'Wysyła kod SMS (6 cyfr, 5 min); limity: 60 s między kodami, 5 kodów na godzinę' })
  requestOtp(@Body(new ZodPipe(otpRequestSchema)) body: OtpRequest) {
    return this.auth.requestOtp(body.phone);
  }

  @Public()
  @Post('auth/otp/verify')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Potwierdza kod; zakłada konto przy pierwszym logowaniu i zwraca tokeny oraz następny ekran (opcjonalnie urządzenie, platforma i wersja aplikacji do listy sesji)',
  })
  verifyOtp(@Body(new ZodPipe(otpVerifySchema)) body: OtpVerify) {
    return this.auth.verifyOtp(body.phone, body.code, {
      device: body.device,
      platform: body.platform,
      appVersion: body.appVersion,
    });
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Nowa para tokenów (rotacja); ponowne użycie starego tokenu wylogowuje urządzenie' })
  refresh(@Body(new ZodPipe(refreshSchema)) body: RefreshRequest) {
    return this.auth.refresh(body.refreshToken, { platform: body.platform, appVersion: body.appVersion });
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshSchema)) body: RefreshRequest): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @CustomerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Konto klienta, następny ekran i dokumenty do akceptacji' })
  me(@CurrentCustomer() customer: CustomerPrincipal) {
    return this.auth.me(customer.userId);
  }

  @CustomerAuth()
  @Post('me/registration')
  @HttpCode(200)
  @ApiOperation({ summary: 'Zakończenie rejestracji: imię, wiek i zgody na obowiązujące wersje dokumentów' })
  register(@CurrentCustomer() customer: CustomerPrincipal, @Body(new ZodPipe(registrationSchema)) body: Registration) {
    return this.auth.register(customer.userId, body);
  }

  @CustomerAuth()
  @Post('me/consents')
  @HttpCode(200)
  @ApiOperation({ summary: 'Akceptacja nowych wersji dokumentów' })
  acceptDocuments(
    @CurrentCustomer() customer: CustomerPrincipal,
    @Body(new ZodPipe(consentsAcceptSchema)) body: ConsentsAccept,
  ) {
    return this.auth.acceptDocuments(customer.userId, body.acceptedVersionIds);
  }

  @CustomerAuth()
  @Patch('me')
  updateProfile(@CurrentCustomer() customer: CustomerPrincipal, @Body(new ZodPipe(profileUpdateSchema)) body: ProfileUpdate) {
    return this.auth.updateProfile(customer.userId, body);
  }

  @Public()
  @Get('legal/:slug')
  @ApiOperation({ summary: 'Obowiązująca wersja dokumentu (regulamin, polityka prywatności, zasady jazdy)' })
  legal(@Param('slug', new ZodPipe(z.string().regex(/^[a-z0-9-]+$/))) slug: string) {
    return this.auth.legalDocument(slug);
  }
}
