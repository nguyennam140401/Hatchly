// US1-AS1..AS3, SC-001: cô lập tenant trên bảng mẫu sandbox.tenant_notes – 4 thao tác × 2 chiều.
import { describeCrossTenant } from './helpers/cross-tenant';
import { tenantNotes } from './sandbox/schema';

let n = 0;
describeCrossTenant({
  table: tenantNotes,
  insertRow: () => ({ title: `ghi chú ${++n}`, secret_note: 'bí mật' }),
  updateRow: () => ({ status: 'published' }),
});
