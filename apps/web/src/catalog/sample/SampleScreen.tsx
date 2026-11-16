import type { MeResponse } from '@app/shared/auth';
import { permissionsOf } from '@app/shared/auth';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AsyncBoundary } from '../../app/AsyncBoundary';
import { useApiQuery } from '../../lib/api/hooks';
import { createQueryClient } from '../../lib/api/query-client';
import { useAppForm } from '../../lib/forms/useAppForm';
import { SessionContext } from '../../lib/session/context';
import { Button } from '../../ui/button/Button';
import { PostCard } from '../../ui/cards/PostCard';
import { Chip } from '../../ui/chip-tabs/Chip';
import { Form } from '../../ui/form/Form';
import { TextAreaField, TextField } from '../../ui/form/fields/inputs';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import {
  fetchScenario,
  SCENARIOS,
  type SampleResponse,
  type Scenario,
} from '../fixtures/scenarios';
import { minLength, objectSchema } from './forms/sample-schema';

// Màn hình mẫu (T068, SC-002): danh sách + thẻ + biểu mẫu dựng CHỈ từ thành phần dùng chung – không màu/cỡ chữ/khoảng
// cách viết cứng. Đây là mẫu cho người thêm màn hình mới; `check-web-rules` kiểm tra tệp này như mọi tệp khác.

interface IdeaValues extends Record<string, unknown> {
  title: string;
  note: string;
}

const ideaSchema = objectSchema<IdeaValues>({
  title: minLength(3, 'Tiêu đề quá ngắn. Hãy nhập ít nhất 3 ký tự.'),
});

const SCENARIO_LABEL: Record<Scenario, string> = {
  loading: 'Đang tải',
  empty: 'Trống',
  error: 'Lỗi',
  locked: 'Bị khóa',
  partial: 'Một phần',
  ok: 'Bình thường',
};

// Phiên giả chỉ để dựng mẫu; không bao giờ đi cùng tài khoản thật.
const CATALOG_ME: MeResponse = {
  user: {
    id: 'catalog-user',
    displayName: 'Chủ Tiệm Mẫu',
    email: 'mau@example.test',
    emailVerified: true,
  },
  account: { id: 'catalog-account', status: 'active' },
  role: 'owner',
  permissions: permissionsOf('owner'),
};

function PostList({ scenario }: { scenario: Scenario }) {
  const query = useApiQuery<SampleResponse>(
    ['catalog', 'sample', scenario],
    () => fetchScenario(scenario),
    {
      freshness: 'volatile',
    },
  );
  const locked = query.data?.locked;
  const part = query.data?.partial;
  return (
    <AsyncBoundary
      query={query}
      isEmpty={(d) => d.items.length === 0}
      empty={{
        message: 'Chưa có bài nào. Hãy tạo bài đầu tiên.',
        action: <Button variant="primary">Tạo bài</Button>,
      }}
      {...(locked !== undefined
        ? {
            lockedBy: {
              locked: true,
              reason: locked.reason,
              reopensAt: new Date(locked.reopensAt),
            },
          }
        : {})}
      partial={() =>
        part !== undefined
          ? {
              done: `Đã đăng: ${String(part.done)}`,
              attention: `Cần bạn xử lý: ${String(part.attention)}`,
            }
          : null
      }
    >
      {(data) => (
        <ul className="flex flex-col gap-3">
          {data.items.map((item) => (
            <li key={item.id}>
              <PostCard post={item} />
            </li>
          ))}
        </ul>
      )}
    </AsyncBoundary>
  );
}

function IdeaForm() {
  const form = useAppForm<IdeaValues>({
    schema: ideaSchema,
    defaultValues: { title: '', note: '' },
    onSubmit: () => Promise.resolve(),
  });
  return (
    <Form form={form} title="Ý tưởng mới" submitLabel="Lưu ý tưởng">
      <TextField name="title" label="Tiêu đề" help="Hiện ở đầu bài." required />
      <TextAreaField name="note" label="Ghi chú" maxChars={200} />
    </Form>
  );
}

export function SampleScreen() {
  const [client] = useState(createQueryClient);
  const [scenario, setScenario] = useState<Scenario>('ok');
  const session = useMemo(() => ({ me: CATALOG_ME, refresh: () => Promise.resolve() }), []);
  return (
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-gutter">
          <Page>
            <PageHeader
              title="Màn hình mẫu"
              description="Danh sách, thẻ và biểu mẫu chỉ dùng thành phần dùng chung."
            />
            <Link
              to="/_catalog"
              className="inline-flex min-h-touch items-center text-label text-brand underline focus-visible:ring-2 focus-visible:ring-brand"
            >
              Về danh mục
            </Link>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Tình huống hiển thị">
              {SCENARIOS.map((s) => (
                <Chip
                  key={s}
                  label={SCENARIO_LABEL[s]}
                  selected={scenario === s}
                  onClick={() => {
                    setScenario(s);
                  }}
                />
              ))}
            </div>
            <section aria-labelledby="sample-posts" className="flex flex-col gap-3">
              <h2 id="sample-posts" className="text-title">
                Bài viết gần đây
              </h2>
              <PostList key={scenario} scenario={scenario} />
            </section>
            <IdeaForm />
          </Page>
        </div>
      </SessionContext.Provider>
    </QueryClientProvider>
  );
}
