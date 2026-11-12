// Mẫu vi phạm (006 R16): module context viết SQL đọc thẳng bảng của module account.
// Chú thích nhắc "account"."users" KHÔNG bị tính (chỉ quét chuỗi/template SQL).
const sql = (s: TemplateStringsArray): string => s.join('');
export const leak = sql`select * from "account"."users"`;
export const ownOk = sql`select * from context.business_profiles`;
export const fnOk = `SELECT account.current_account_id()`;
export const permissionOk = 'account.delete';
