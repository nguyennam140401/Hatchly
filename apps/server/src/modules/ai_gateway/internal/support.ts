// Thao tác nội bộ cho hỗ trợ/quản trị (CÓ số tiền) – KHÔNG nằm trong AiGatewayPublicApi, không xuất cho
// module khác (005, contracts/ai-gateway.md mục 1). CHỈ khai báo kiểu: cài đặt kèm nhật ký kiểm toán
// (`supportViewAccount`) là WBS 4.7.

export interface AiBudgetDetail {
  cycleStart: string;
  usedMicroUsd: number;
  reservedMicroUsd: number;
  capMicroUsd: number;
  softLimitMicroUsd: number;
}

export interface AiGatewaySupportApi {
  getBudgetDetail(accountId: string): Promise<AiBudgetDetail>;
}

export const AI_GATEWAY_SUPPORT = Symbol('AI_GATEWAY_SUPPORT');
