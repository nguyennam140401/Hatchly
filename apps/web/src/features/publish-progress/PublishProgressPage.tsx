import { Link, useParams } from 'react-router';
import { Page } from '../../ui/layout/Page';
import { PageHeader } from '../../ui/layout/PageHeader';
import { PublishProgress } from './PublishProgress';

/** Trang "Tiến trình đăng" của một bài (013): mở từ danh sách bài / thông báo "Xem lượt đăng". */
export function PublishProgressPage() {
  const { id } = useParams();
  return (
    <div className="mx-auto w-full max-w-3xl px-gutter py-6">
      <Page>
        <PageHeader
          title="Tiến trình đăng"
          description="Theo dõi từng kênh: bài đang ở bước nào, lỗi (nếu có) và cách xử lý."
          actions={
            <Link
              className="inline-flex min-h-touch items-center text-label text-brand underline"
              to={id === undefined ? '/posts' : `/posts/${id}`}
            >
              Về bài viết
            </Link>
          }
        />
        {id === undefined ? <p>Không tìm thấy bài.</p> : <PublishProgress postId={id} />}
      </Page>
    </div>
  );
}
