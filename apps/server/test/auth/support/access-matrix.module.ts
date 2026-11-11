import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { CustomerAccess, Public, StaffAccess } from '../../../src/core/auth/access.decorators';
import { currentActor } from '../../../src/core/auth/actor';
import { isCustomerPermission, PERMISSION_LIST } from '../../../src/core/auth/permissions';
import { currentAccountId } from '../../../src/core/db/transaction';

// AccessMatrixTestModule (004, T038) – CHỈ trong test/, không vào bản phát hành. Mỗi quyền một điểm
// cuối khai báo đúng loại; cùng vài điểm cuối đặc biệt cho ma trận SC-003 và kiểm thử SC-004.

function permController(): Type {
  // Sinh một handler cho mỗi quyền, gắn khai báo bằng decorator lúc chạy.
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- handler được gắn lúc chạy bên dưới
  class PermController {}
  for (const permission of PERMISSION_LIST) {
    const name = `perm_${permission.replace('.', '_')}`;
    const handler = function (this: unknown): unknown {
      const actor = currentActor();
      return { permission, actor: actor?.kind ?? null, account: currentAccountId() };
    };
    Object.defineProperty(handler, 'name', { value: name });
    Object.defineProperty(PermController.prototype, name, {
      value: handler,
      writable: true,
      configurable: true,
    });
    const descriptor = Object.getOwnPropertyDescriptor(PermController.prototype, name);
    if (descriptor === undefined) throw new Error('descriptor');
    const access = isCustomerPermission(permission)
      ? CustomerAccess(permission)
      : StaffAccess(permission);
    access(PermController.prototype, name, descriptor);
    Get(permission)(PermController.prototype, name, descriptor);
  }
  Controller('__test/perm')(PermController);
  return PermController;
}

type Type = new (...args: never[]) => unknown;

@Controller('__test')
class SpecialController {
  @Get('customer-unverified')
  @CustomerAccess({ allowUnverifiedEmail: true })
  unverified(): unknown {
    return { account: currentAccountId() };
  }

  @Get('public')
  @Public()
  pub(): unknown {
    return { actor: currentActor()?.kind ?? null, account: currentAccountId() };
  }

  @Get('undeclared')
  undeclared(): string {
    return 'không bao giờ tới';
  }

  @Post('echo-account/:accountId')
  @CustomerAccess('status.view')
  echo(
    @Param('accountId') pathAccountId: string,
    @Query('accountId') queryAccountId: string | undefined,
    @Body() body: { accountId?: string; account_id?: string } | undefined,
  ): unknown {
    return {
      current: currentAccountId(),
      path: pathAccountId,
      query: queryAccountId ?? null,
      body: body?.accountId ?? body?.account_id ?? null,
    };
  }
}

@Module({ controllers: [permController() as never, SpecialController] })
export class AccessMatrixTestModule {}
