import { pgRole } from 'drizzle-orm/pg-core';

// Vai trò CSDL (research R6). Tạo bằng bước bootstrap (drizzle/bootstrap/roles.sql), KHÔNG bằng
// migration – `.existing()` để drizzle-kit chỉ tham chiếu trong chính sách, không tạo/xóa.

/** API + Worker (việc của tenant) – chịu RLS. */
export const appRole = pgRole('app').existing();
/** Worker (việc dùng chung) – chịu cùng RLS khi đặt ngữ cảnh tenant. */
export const systemRole = pgRole('system').existing();
/** Tra cứu hỗ trợ – chỉ đọc khung nhìn đã lọc. */
export const supportRole = pgRole('support').existing();
/** Chủ mọi đối tượng – chỉ công cụ migration dùng. */
export const ownerRole = pgRole('owner').existing();
