import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CONFIG, type AppConfig } from '../config.js';
import { AuthGuard } from './auth.guard.js';
import { JWT, OTP_CODES, SECRET_BOX } from './auth.tokens.js';
import { JwtCodec } from './crypto/jwt.js';
import { OtpCodes, SecretBox } from './crypto/secrets.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { LoggingSmsGateway, SmsGateway } from './sms.gateway.js';
import { StaffAuthController } from './staff-auth.controller.js';
import { StaffAuthService } from './staff-auth.service.js';
import { StaffPermissionsService } from './staff-permissions.service.js';

/**
 * Uwierzytelnianie klientów i operatorów oraz globalny strażnik dostępu (ADR 0019, ADR 0028, ADR 0035).
 * Globalny, bo strażnik i uprawnienia operatora są potrzebne w każdym module panelu.
 */
@Global()
@Module({
  controllers: [CustomerAuthController, StaffAuthController],
  providers: [
    { provide: JWT, inject: [CONFIG], useFactory: (c: AppConfig) => new JwtCodec(c.JWT_SECRET) },
    { provide: SECRET_BOX, inject: [CONFIG], useFactory: (c: AppConfig) => new SecretBox(c.TOTP_ENCRYPTION_KEY) },
    // Klucz skrótów kodów SMS wyprowadzony z sekretu JWT, żeby nie mnożyć zmiennych środowiskowych.
    { provide: OTP_CODES, inject: [CONFIG], useFactory: (c: AppConfig) => new OtpCodes(`otp:${c.JWT_SECRET}`) },
    LoggingSmsGateway,
    { provide: SmsGateway, useExisting: LoggingSmsGateway },
    StaffPermissionsService,
    CustomerAuthService,
    StaffAuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [JWT, StaffPermissionsService, SmsGateway, LoggingSmsGateway],
})
export class AuthModule {}
