// Giao diện công khai của lớp CSDL cho module (contracts/db-layer-api.md mục 1, 2, 4).
// KHÔNG xuất bể kết nối, DatabaseService, createPool hay tableRegistry (mục 5 – chỉ hạ tầng/kiểm thử):
// module không bao giờ cầm thể hiện CSDL "trần" (research R5 lớp 1).
export { moduleSchema } from './module-schema';
export {
  microUsd,
  nonNegativeCheck,
  partitionedLogTable,
  sharedTable,
  tenantTable,
  type TenantColumns,
  type TenantTableOptions,
} from './table-builders';
export { accounts, CURRENT_ACCOUNT_ID } from './tenant-root';
export { currentAccountId, systemTx, tenantTx, type Db } from './transaction';
export { supportSearch, supportViewAccount, type SupportActor } from './support';
export { updateVersioned, versionConflict, type VersionedTable } from './versioned';
export {
  DbConnectionError,
  DbQueryError,
  DbPolicyViolationError,
  TenantContextError,
  type TenantContextErrorCode,
} from './errors';
