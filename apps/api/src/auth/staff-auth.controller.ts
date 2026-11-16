import {
  invitationAcceptSchema,
  STAFF_REFRESH_COOKIE,
  staffLoginSchema,
  totpVerifySchema,
  type InvitationAccept,
  type StaffLogin,
  type StaffSession,
  type TotpVerify,
} from '@hulajnogi/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-query.js';
import { CONFIG, type AppConfig } from '../config.js';
import { CurrentStaff, Public, StaffAuth, type StaffPrincipal } from './decorators.js';
import { StaffAuthService, type StaffSessionWithRefresh } from './staff-auth.service.js';

const COOKIE_PATH = '/admin/auth';
const tokenParam = new ZodPipe(z.string().regex(/^[A-Za-z0-9_-]{40,60}$/));

/** Logowanie operatora do panelu (ADR 0019, ADR 0035). */
@ApiTags('panel: logowanie')
@Controller('admin/auth')
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hasło: zwraca token drugiego kroku (kod TOTP albo konfiguracja TOTP)' })
  login(@Body(new ZodPipe(staffLoginSchema)) body: StaffLogin) {
    return this.auth.login(body.email, body.password, body.remember);
  }

  @Public()
  @Post('totp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Kod TOTP: otwiera sesję; token odświeżający w ciasteczku httpOnly' })
  async totp(
    @Body(new ZodPipe(totpVerifySchema)) body: TotpVerify,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffSession> {
    return this.withCookie(reply, await this.auth.verifyTotp(body.mfaToken, body.code, userAgent(request)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Nowy token dostępowy z ciasteczka sesji (rotacja tokenu odświeżającego)' })
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<StaffSession> {
    try {
      return this.withCookie(reply, await this.auth.refresh(request.cookies[STAFF_REFRESH_COOKIE], userAgent(request)));
    } catch (error) {
      // Nieważne ciasteczko: usuwamy je, żeby panel wrócił do logowania zamiast ponawiać odświeżanie.
      reply.clearCookie(STAFF_REFRESH_COOKIE, { path: COOKIE_PATH });
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    await this.auth.logout(request.cookies[STAFF_REFRESH_COOKIE]);
    reply.clearCookie(STAFF_REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @StaffAuth()
  @Get('me')
  @ApiOperation({ summary: 'Zalogowany operator z rolami i uprawnieniami (panel ukrywa niedostępne pozycje)' })
  me(@CurrentStaff() staff: StaffPrincipal) {
    return this.auth.me(staff.staffId);
  }

  @Public()
  @Get('invitations/:token')
  @ApiOperation({ summary: 'Dane zaproszenia do ekranu aktywacji konta' })
  invitation(@Param('token', tokenParam) token: string) {
    return this.auth.invitation(token);
  }

  @Public()
  @Post('invitations/:token/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hasło z zaproszenia; dalej konfiguracja TOTP z tokenem drugiego kroku' })
  acceptInvitation(@Param('token', tokenParam) token: string, @Body(new ZodPipe(invitationAcceptSchema)) body: InvitationAccept) {
    return this.auth.acceptInvitation(token, body.name, body.password);
  }

  private withCookie(reply: FastifyReply, session: StaffSessionWithRefresh): StaffSession {
    const { refreshToken, refreshExpiresAt, ...rest } = session;
    reply.setCookie(STAFF_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.NODE_ENV === 'production',
      path: COOKIE_PATH,
      expires: refreshExpiresAt,
    });
    return rest;
  }
}

function userAgent(request: FastifyRequest): string | null {
  return request.headers['user-agent']?.slice(0, 200) ?? null;
}
