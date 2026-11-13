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
import { listActiveMembers } from './internal/members-directory';
import { describeMembers } from './internal/members/describe-members';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from './public-api';

/** Thao tác chỉ có ở API (cần phần xác thực) – Worker gọi nhầm thì báo rõ. */
function apiOnly(name: string): () => Promise<never> {
  return () => Promise.reject(new Error(`AccountPublicApi.${name} chỉ dùng được ở API`));
}

/**
 * Module Tài khoản & Gói (`account`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 * Ở API: xác thực (004) – controller, dịch vụ, `SESSION_RESOLVER` cho AccessGuard. Worker: danh bạ
 * thành viên (`listActiveMembers` – 005).
 * Ở API: xác thực (004) – controller, dịch vụ, `SESSION_RESOLVER` cho AccessGuard. Worker: chưa có gì.
 * `global` ở API: module được phép (allowedDeps chứa `account`, kiểm bằng check:boundaries) tiêm
 * `ACCOUNT_PUBLIC_API` mà không phải tự nhập lại AccountModule (006 – module `context`).
 */
@Module({})
export class AccountModule {
  static forUnit(unit: 'api' | 'worker'): DynamicModule {
    if (unit === 'worker') {
      // Worker: chỉ phần không cần xác thực – danh bạ thành viên cho hàng chờ `notify` (005).
      const workerApi: AccountPublicApi = {
        listActiveMembers,
        // Đọc tên thành viên trong ngữ cảnh tài khoản – không cần phiên đăng nhập nên Worker dùng được.
        describeMembers: (userIds) => describeMembers(userIds),
        addMember: apiOnly('addMember'),
        removeMember: apiOnly('removeMember'),
        disableMember: apiOnly('disableMember'),
        createVerifiedOwner: apiOnly('createVerifiedOwner'),
        createStaff: apiOnly('createStaff'),
      };
      return {
        module: AccountModule,
        global: true,
        providers: [{ provide: ACCOUNT_PUBLIC_API, useValue: workerApi }],
        exports: [ACCOUNT_PUBLIC_API],
      };
    }
    return {
      module: AccountModule,
      // Global: Thông báo (005) tiêm ACCOUNT_PUBLIC_API để tra người nhận; ranh giới do manifest kiểm.
      global: true,
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
            listActiveMembers,
            addMember: (input) => members.addMember(input),
            removeMember: (input) => members.removeMember(input),
            disableMember: (input) => members.disableMember(input),
            createVerifiedOwner: (input) => registration.createVerifiedOwner(input),
            describeMembers: (userIds) => describeMembers(userIds),
            createStaff: async (input) => ({ id: (await staff.create(input)).id }),
          }),
        },
      ],
      exports: [SESSION_RESOLVER, ACCOUNT_PUBLIC_API],
    };
  }
}
