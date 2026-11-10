import { type DynamicModule, Module } from '@nestjs/common';
import { AUTH_CONFIG, MailModule, SESSION_RESOLVER, type AuthConfig } from '../../core';
import { CustomerAuthController } from './internal/auth/customer-auth.controller';
import { EmailVerificationService } from './internal/auth/email-verification.service';
import { MailDispatcher } from './internal/auth/mail/dispatch';
import { MembersService } from './internal/auth/members.service';
import { PasswordHasher } from './internal/auth/password/password-hasher';
import { PasswordResetService } from './internal/auth/password-reset.service';
import { RegistrationService } from './internal/auth/registration.service';
import { SessionService } from './internal/auth/session.service';
import { StaffAuthController } from './internal/auth/staff-auth.controller';
import { StaffService } from './internal/auth/staff.service';
import { ThrottleService } from './internal/auth/throttle.service';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from './public-api';

/**
 * Module Tài khoản & Gói (`account`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 * Ở API: xác thực (004) – controller, dịch vụ, `SESSION_RESOLVER` cho AccessGuard. Worker: chưa có gì.
 */
@Module({})
export class AccountModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    if (unit === 'worker') return { module: AccountModule };
    return {
      module: AccountModule,
      imports: [MailModule],
      controllers: [CustomerAuthController, StaffAuthController],
      providers: [
        {
          provide: PasswordHasher,
          inject: [AUTH_CONFIG],
          useFactory: (config: AuthConfig) =>
            new PasswordHasher({
              memoryCost: config.argon2MemoryKib,
              timeCost: config.argon2TimeCost,
            }),
        },
        ThrottleService,
        MailDispatcher,
        StaffService,
        SessionService,
        { provide: SESSION_RESOLVER, useExisting: SessionService },
        RegistrationService,
        EmailVerificationService,
        PasswordResetService,
        MembersService,
        {
          provide: ACCOUNT_PUBLIC_API,
          inject: [MembersService, StaffService, RegistrationService],
          useFactory: (
            members: MembersService,
            staff: StaffService,
            registration: RegistrationService,
          ): AccountPublicApi => ({
            addMember: (input) => members.addMember(input),
            removeMember: (input) => members.removeMember(input),
            disableMember: (input) => members.disableMember(input),
            createVerifiedOwner: (input) => registration.createVerifiedOwner(input),
            createStaff: async (input) => ({ id: (await staff.create(input)).id }),
          }),
        },
      ],
      exports: [SESSION_RESOLVER, ACCOUNT_PUBLIC_API],
    };
  }
}
