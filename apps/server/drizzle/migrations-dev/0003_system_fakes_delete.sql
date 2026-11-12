-- Migration dev 0003 (005) – CHỈ áp khi APP_ENV ∈ {development, test}. Vai trò system (Worker) đặt lại được
-- trạng thái giả của ngân sách AI hệ thống (fakeAi.reset ở ngữ cảnh hệ thống). Tenant vẫn không có quyền nào.
GRANT DELETE ON sandbox.ai_fake_system_reservations, sandbox.ai_fake_system_cost_ledger TO "system";
