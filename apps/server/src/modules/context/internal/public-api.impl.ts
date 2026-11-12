import { and, eq, isNull } from 'drizzle-orm';
import { tenantTx } from '../../../core';
import type { ContextPublicApi, CurrentBusinessProfile } from '../public-api';
import { businessProfiles, profileVersions } from './db/schema';
import { rowToFields } from './profile-content';

/**
 * Hồ sơ hiện hành cho module khác (FR-013, FR-014, FR-015). Chạy được ở API (ngữ cảnh yêu cầu) và
 * Worker (ngữ cảnh việc nền) vì chỉ dựa vào tenantTx. Luôn đọc CSDL – không cache.
 */
export async function getCurrentProfile(): Promise<CurrentBusinessProfile | null> {
  return tenantTx(async (db) => {
    const rows = await db
      .select({
        profileId: businessProfiles.id,
        version: businessProfiles.version,
        row: profileVersions,
      })
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
    const found = rows[0];
    if (found === undefined) return null;
    // Liệt kê tường minh: không rò account_id, saved_by_user_id ra ngoài module.
    return {
      profileId: found.profileId,
      version: found.version,
      savedAt: found.row.created_at.toISOString(),
      ...rowToFields(found.row),
    };
  });
}

export const contextPublicApi: ContextPublicApi = { getCurrentProfile };
