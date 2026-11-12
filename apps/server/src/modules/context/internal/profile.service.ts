import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@app/shared/core';
import {
  VERSION_PAGE_SIZE,
  type GetProfileResponse,
  type ProfileFieldsValue,
  type ProfileView,
  type SavedBy,
  type SaveProfileResponse,
  type VersionDetailResponse,
  type VersionListResponse,
} from '@app/shared/context';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  AppError,
  currentAccountId,
  tenantTx,
  updateVersioned,
  uuidV7,
  versionConflict,
  type Db,
} from '../../../core';
import { ACCOUNT_PUBLIC_API, type AccountPublicApi } from '../../account';
import { enqueue } from '../../queue';
import { profileChanged, profileChangedDedupeKey } from '../jobs';
import {
  businessProfiles,
  profileVersions,
  type BusinessProfileRow,
  type ProfileVersionRow,
} from './db/schema';
import { fieldsToRow, missingOptional, rowToFields, sameProfileContent } from './profile-content';

// Dịch vụ hồ sơ kinh doanh (006 data-model mục 4) – MẪU cho thao tác ghi nghiệp vụ:
// - Mọi truy cập CSDL trong tenantTx (tài khoản lấy từ ngữ cảnh – không tham số accountId).
// - Khóa lạc quan bằng updateVersioned; tạo việc nền bằng enqueue TRONG CÙNG giao dịch.
// - Đọc dữ liệu module khác (tên người lưu) qua AccountPublicApi, không đọc bảng của `account`.
// - Không cache (FR-015). Nhật ký không chứa nội dung hồ sơ (FR-020).

const CONFLICT_MESSAGE = 'Hồ sơ vừa được cập nhật ở nơi khác. Tải bản mới nhất để xem.';
const CONFLICT_ACTION = 'Tải bản mới nhất';

function profileConflict(): AppError {
  return versionConflict(CONFLICT_MESSAGE, CONFLICT_ACTION);
}

/** Không tìm thấy phiên bản – CÙNG một lỗi cho "không tồn tại" và "của tài khoản khác" (FR-011). */
export function versionNotFound(): AppError {
  return new AppError({
    code: ERROR_CODES.NOT_FOUND,
    httpStatus: 404,
    message: 'Không tìm thấy phiên bản này.',
    actions: [{ kind: 'navigate', label: 'Về hồ sơ kinh doanh', href: '/business-profile' }],
  });
}

/**
 * Lỗi trùng khóa duy nhất `constraint`. Bên trong giao dịch, lỗi còn là lỗi gốc của trình điều khiển
 * (bọc trong `cause` của Drizzle) – chỉ đọc SQLSTATE và tên ràng buộc, không đọc thông điệp/giá trị.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === '23505') return e.constraint === constraint;
    current = e.cause;
  }
  return false;
}

/** Dòng đầu của `INSERT … RETURNING` (luôn có một dòng – thiếu là lỗi lập trình). */
function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('INSERT … RETURNING không trả dòng nào');
  return row;
}

/** Phần của AccountPublicApi mà dịch vụ cần (kiểm thử truyền bản thật hoặc bản giả). */
export type MemberDirectory = Pick<AccountPublicApi, 'describeMembers'>;

@Injectable()
export class ProfileService {
  private readonly logger = new Logger('context');

  constructor(@Inject(ACCOUNT_PUBLIC_API) private readonly members: MemberDirectory) {}

  /** `GET /context/profile`. */
  async getProfile(): Promise<GetProfileResponse> {
    return tenantTx(async (db) => {
      const current = await this.readCurrent(db);
      if (current === null) return { profile: null, missingOptional: missingOptional(null) };
      return {
        profile: await this.toView(current.profile, current.version),
        missingOptional: missingOptional(rowToFields(current.version)),
      };
    });
  }

  /**
   * `PUT /context/profile` – một tenantTx, ≤ 3 câu lệnh ghi (cập nhật hồ sơ, thêm phiên bản, tạo việc).
   * `fields` đã chuẩn hóa + hợp lệ bởi `ProfileFields` (@ValidBody); CHECK của CSDL là lớp thứ hai.
   */
  async saveProfile(
    expectedVersion: number,
    fields: ProfileFieldsValue,
    userId: string,
  ): Promise<SaveProfileResponse> {
    const result = await tenantTx(async (db) => {
      if (expectedVersion === 0) return this.createFirst(db, fields, userId);

      const current = await this.readCurrent(db);
      // Chưa có hồ sơ (web giữ số phiên bản sai) hoặc đã có phiên bản mới hơn → xung đột.
      if (current?.profile.version !== expectedVersion) throw profileConflict();
      if (sameProfileContent(rowToFields(current.version), fields)) {
        return { changed: false, profile: await this.toView(current.profile, current.version) };
      }
      // Hai người cùng lưu từ phiên bản N: chỉ một UPDATE … WHERE version = N khớp, người kia xung đột.
      const profile = await updateVersioned(
        db,
        businessProfiles,
        { id: current.profile.id, expectedVersion },
        {},
        { conflictMessage: CONFLICT_MESSAGE, conflictActionLabel: CONFLICT_ACTION },
      );
      const version = await this.insertVersion(db, profile, fields, userId);
      return { changed: true, profile: await this.toView(profile, version) };
    });
    this.logger.log({
      msg: 'context.profile.saved',
      event: 'context.profile.saved',
      version: result.profile.version,
      changed: result.changed,
    });
    return result;
  }

  /** `GET /context/profile/versions?page=` – mới nhất trước, 20 dòng/trang. */
  async listVersions(page: number): Promise<VersionListResponse> {
    return tenantTx(async (db) => {
      const profile = await this.readProfile(db);
      if (profile === null) return { items: [], page, pageSize: VERSION_PAGE_SIZE, total: 0 };
      const where = eq(profileVersions.profile_id, profile.id);
      const rows = await db
        .select()
        .from(profileVersions)
        .where(where)
        .orderBy(desc(profileVersions.version_number))
        .limit(VERSION_PAGE_SIZE)
        .offset((page - 1) * VERSION_PAGE_SIZE);
      const [totalRow] = await db.select({ n: count() }).from(profileVersions).where(where);
      const names = await this.savedByMap(rows);
      return {
        items: rows.map((r) => ({
          versionId: r.id,
          version: r.version_number,
          savedAt: r.created_at.toISOString(),
          savedBy: names(r.saved_by_user_id),
        })),
        page,
        pageSize: VERSION_PAGE_SIZE,
        total: totalRow?.n ?? 0,
      };
    });
  }

  /** `GET /context/profile/versions/:versionId`. RLS ẩn dòng của tài khoản khác → cùng 404. */
  async getVersion(versionId: string): Promise<VersionDetailResponse> {
    return tenantTx(async (db) => {
      const rows = await db
        .select({ version: profileVersions, currentVersion: businessProfiles.version })
        .from(profileVersions)
        .innerJoin(businessProfiles, eq(businessProfiles.id, profileVersions.profile_id))
        .where(and(eq(profileVersions.id, versionId), isNull(businessProfiles.deleted_at)))
        .limit(1);
      const row = rows[0];
      if (row === undefined) throw versionNotFound();
      const names = await this.savedByMap([row.version]);
      return {
        versionId: row.version.id,
        version: row.version.version_number,
        savedAt: row.version.created_at.toISOString(),
        savedBy: names(row.version.saved_by_user_id),
        fields: rowToFields(row.version),
        isCurrent: row.version.version_number === row.currentVersion,
      };
    });
  }

  // ------------------------------------------------------------------------------------------

  /** Lần lưu đầu: chỉ mục duy nhất (account_id) chặn hồ sơ thứ hai → xung đột (research R2). */
  private async createFirst(
    db: Db,
    fields: ProfileFieldsValue,
    userId: string,
  ): Promise<SaveProfileResponse> {
    const accountId = currentAccountId();
    if (accountId === null) throw new Error('saveProfile: thiếu ngữ cảnh tài khoản');
    let profile: BusinessProfileRow;
    try {
      const inserted = await db
        .insert(businessProfiles)
        .values({ id: uuidV7(), account_id: accountId, version: 1 })
        .returning();
      profile = firstRow(inserted);
    } catch (err) {
      if (isUniqueViolation(err, 'business_profiles_account_id_key')) throw profileConflict();
      throw err;
    }
    const version = await this.insertVersion(db, profile, fields, userId);
    return { changed: true, profile: await this.toView(profile, version) };
  }

  /** Thêm phiên bản `profile.version` + tạo việc "hồ sơ đã thay đổi" trong cùng giao dịch. */
  private async insertVersion(
    db: Db,
    profile: BusinessProfileRow,
    fields: ProfileFieldsValue,
    userId: string,
  ): Promise<ProfileVersionRow> {
    const inserted = await db
      .insert(profileVersions)
      .values({
        account_id: profile.account_id,
        profile_id: profile.id,
        version_number: profile.version,
        saved_by_user_id: userId,
        ...fieldsToRow(fields),
      })
      .returning();
    // Hoàn tác giao dịch = không có việc (FR-013a). Payload chỉ mã tham chiếu.
    await enqueue(
      profileChanged,
      { profileId: profile.id, version: profile.version },
      { dedupeKey: profileChangedDedupeKey(profile.id, profile.version) },
    );
    return firstRow(inserted);
  }

  private async readProfile(db: Db): Promise<BusinessProfileRow | null> {
    const rows = await db
      .select()
      .from(businessProfiles)
      .where(isNull(businessProfiles.deleted_at))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Hồ sơ + phiên bản hiện hành (version_number = business_profiles.version). */
  private async readCurrent(
    db: Db,
  ): Promise<{ profile: BusinessProfileRow; version: ProfileVersionRow } | null> {
    const rows = await db
      .select({ profile: businessProfiles, version: profileVersions })
      .from(businessProfiles)
      .innerJoin(
        profileVersions,
        and(
          eq(profileVersions.profile_id, businessProfiles.id),
          eq(profileVersions.version_number, businessProfiles.version),
        ),
      )
      .where(isNull(businessProfiles.deleted_at))
      .limit(1);
    return rows[0] ?? null;
  }

  private async toView(
    profile: BusinessProfileRow,
    version: ProfileVersionRow,
  ): Promise<ProfileView> {
    const names = await this.savedByMap([version]);
    return {
      profileId: profile.id,
      version: version.version_number,
      savedAt: version.created_at.toISOString(),
      savedBy: names(version.saved_by_user_id),
      fields: rowToFields(version),
    };
  }

  /**
   * Tên người lưu – MỘT lần gọi describeMembers cho cả trang. Không còn trong tài khoản hoặc đã bị gỡ
   * → "Thành viên đã rời" (`left`, không tên); bị khóa vẫn hiện tên.
   */
  private async savedByMap(
    versions: Pick<ProfileVersionRow, 'saved_by_user_id'>[],
  ): Promise<(userId: string) => SavedBy> {
    const ids = [...new Set(versions.map((v) => v.saved_by_user_id))];
    const found = ids.length === 0 ? [] : await this.members.describeMembers(ids);
    const byId = new Map(found.map((m) => [m.userId, m]));
    return (userId) => {
      const m = byId.get(userId);
      if (m === undefined || m.status === 'removed') {
        return { userId, displayName: null, memberStatus: 'left' };
      }
      return { userId, displayName: m.displayName, memberStatus: 'active' };
    };
  }
}
