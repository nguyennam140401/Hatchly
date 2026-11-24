import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleInit,
} from '@nestjs/common';
import {
  APP_CONFIG,
  AUTH_CONFIG,
  MailModule,
  MAILER,
  OAUTH_CONFIG,
  resolveOAuthConfig,
  SESSION_RESOLVER,
  type AppConfig,
  type AuthConfig,
  type Mailer,
  type OAuthConfig,
} from '../../core';
import { registerJobHandler } from '../queue';
import { AccountClaimController } from './internal/auth/account-claim.controller';
import { AccountClaimService } from './internal/auth/account-claim.service';
import { CustomerAuthController } from './internal/auth/customer-auth.controller';
import { runDetachedUsers } from './internal/auth/detached-users.handler';
import { EmailVerificationService } from './internal/auth/email-verification.service';
import { runAuthHousekeeping } from './internal/auth/housekeeping.handler';
import { InvitationsController } from './internal/auth/invitations.controller';
import { InvitationsService } from './internal/auth/invitations.service';
import { LoginMethodsController } from './internal/auth/login-methods.controller';
import { LoginMethodsService } from './internal/auth/login-methods.service';
import { MailDispatcher } from './internal/auth/mail/dispatch';
import { createMailNoticeHandler } from './internal/auth/mail-notice.handler';
import { MembersController } from './internal/auth/members.controller';
import { MembersService } from './internal/auth/members.service';
import { MetaCallbacksController } from './internal/auth/meta-callbacks.controller';
import { MetaCallbacksService } from './internal/auth/meta-callbacks.service';
import { IDENTITY_PROVIDERS } from './internal/auth/oauth/identity-provider';
import { OAuthFlowService } from './internal/auth/oauth/oauth-flow.service';
import { OAuthLoginService } from './internal/auth/oauth/oauth-login.service';
import { OAuthController } from './internal/auth/oauth/oauth.controller';
import { buildIdentityProviders } from './internal/auth/oauth/providers.factory';
import { PasswordHasher } from './internal/auth/password/password-hasher';
import { PasswordResetService } from './internal/auth/password-reset.service';
import { RegistrationService } from './internal/auth/registration.service';
import { SessionService } from './internal/auth/session.service';
import { StaffAuthController } from './internal/auth/staff-auth.controller';
import { StaffService } from './internal/auth/staff.service';
import { ThrottleService } from './internal/auth/throttle.service';
import { listActiveMembers } from './internal/members-directory';
import { getAiCycleAnchor } from './internal/ai-cycle-anchor';
import { countActiveAccounts } from './internal/count-active-accounts';
import { getPublishingEligibility } from './internal/publishing-eligibility';
import { describeMembers } from './internal/members/describe-members';
import { authHousekeeping, defineAccountSchedules, detachedUsers, mailNotice } from './jobs';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from './public-api';

/** Thao tác chỉ có ở API (cần phần xác thực) – Worker gọi nhầm thì báo rõ. */
function apiOnly(name: string): () => Promise<never> {
  return () => Promise.reject(new Error(`AccountPublicApi.${name} chỉ dùng được ở API`));
}

/** Đăng ký bộ xử lý việc + lịch của module – CHỈ ở Worker, trước khi QueueRuntime bắt đầu lấy việc. */
let workerHandlersRegistered = false;

@Injectable()
class AccountWorkerHandlers implements OnModuleInit {
  private readonly logger = new Logger('account');

  constructor(
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OAUTH_CONFIG) private readonly oauth: OAuthConfig,
  ) {}

  onModuleInit(): void {
    if (workerHandlersRegistered) return;
    workerHandlersRegistered = true;
    const log = {
      info: (entry: Record<string, unknown>) => {
        this.logger.log(entry);
      },
    };
    registerJobHandler(
      mailNotice,
      createMailNoticeHandler({
        mailer: this.mailer,
        webBaseUrl: this.config.WEB_BASE_URL?.replace(/\/+$/, ''),
        detachedRetentionDays: this.oauth.detachedRetentionDays,
        log,
      }),
    );
    registerJobHandler(authHousekeeping, async () => {
      const result = await runAuthHousekeeping();
      log.info({
        msg: 'account.auth_housekeeping.done',
        event: 'account.auth_housekeeping.done',
        ...result,
      });
    });
    registerJobHandler(detachedUsers, async () => {
      const result = await runDetachedUsers({
        retentionDays: this.oauth.detachedRetentionDays,
        noticeDays: this.oauth.detachedNoticeDays,
      });
      log.info({
        msg: 'account.detached_users.done',
        event: 'account.detached_users.done',
        ...result,
      });
    });
    defineAccountSchedules();
  }
}

/**
 * Module Tài khoản & Gói (`account`).
 * Chỉ export provider thuộc giao diện công khai; mọi thứ khác nằm trong `internal/`.
 * - API: xác thực (004), đăng nhập Google/Facebook, cách đăng nhập, lời mời, thành viên (009) –
 *   controller, dịch vụ, `SESSION_RESOLVER` cho AccessGuard.
 * - Worker: danh bạ thành viên (005) + ba loại việc của 009 (`account.mail_notice`,
 *   `account.auth_housekeeping`, `account.detached_users`).
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
        getPublishingEligibility,
        getAiCycleAnchor,
        countActiveAccounts,
        // Tra cứu chỉ đọc (006) – dùng được ở cả Worker.
        describeMembers: (userIds) => describeMembers(userIds),
        addMember: apiOnly('addMember'),
        createPendingInvitation: apiOnly('createPendingInvitation'),
        removeMember: apiOnly('removeMember'),
        disableMember: apiOnly('disableMember'),
        createVerifiedOwner: apiOnly('createVerifiedOwner'),
        createStaff: apiOnly('createStaff'),
      };
      return {
        module: AccountModule,
        global: true,
        imports: [MailModule],
        providers: [
          { provide: ACCOUNT_PUBLIC_API, useValue: workerApi },
          {
            // Worker không gọi nhà cung cấp nên không đòi khóa Google/Facebook.
            provide: OAUTH_CONFIG,
            inject: [APP_CONFIG],
            useFactory: (config: AppConfig) => resolveOAuthConfig(config),
          },
          AccountWorkerHandlers,
        ],
        exports: [ACCOUNT_PUBLIC_API],
      };
    }
    return {
      module: AccountModule,
      // Global: Thông báo (005) tiêm ACCOUNT_PUBLIC_API để tra người nhận; ranh giới do manifest kiểm.
      global: true,
      imports: [MailModule],
      controllers: [
        CustomerAuthController,
        StaffAuthController,
        OAuthController,
        LoginMethodsController,
        MembersController,
        InvitationsController,
        AccountClaimController,
        MetaCallbacksController,
      ],
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
        {
          provide: OAUTH_CONFIG,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) =>
            resolveOAuthConfig(config, { requireCredentials: true }),
        },
        {
          provide: IDENTITY_PROVIDERS,
          inject: [OAUTH_CONFIG, AUTH_CONFIG, APP_CONFIG],
          useFactory: (oauth: OAuthConfig, auth: AuthConfig, config: AppConfig) =>
            buildIdentityProviders(oauth, auth.webBaseUrl, config.APP_ENV),
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
        OAuthFlowService,
        LoginMethodsService,
        InvitationsService,
        OAuthLoginService,
        AccountClaimService,
        MetaCallbacksService,
        {
          provide: ACCOUNT_PUBLIC_API,
          inject: [MembersService, StaffService, RegistrationService, InvitationsService],
          useFactory: (
            members: MembersService,
            staff: StaffService,
            registration: RegistrationService,
            invitations: InvitationsService,
          ): AccountPublicApi => ({
            listActiveMembers,
            getPublishingEligibility,
            getAiCycleAnchor,
            countActiveAccounts,
            addMember: (input) => members.addMember(input),
            createPendingInvitation: (input) => invitations.seedPending(input),
            removeMember: async (input) => {
              await members.removeMember(input);
            },
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
