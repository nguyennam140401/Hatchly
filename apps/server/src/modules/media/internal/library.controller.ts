import { Controller, Delete, Get, HttpCode, Inject } from '@nestjs/common';
import {
  DeleteQuery,
  ListQuery,
  MediaIdParam,
  type ListResponse,
  type MediaDetail,
  type Quota,
  type UsagesResponse,
} from '@app/shared/media';
import { CustomerAccess, ValidParam, ValidQuery } from '../../../core';
import { LibraryService } from './library.service';

// Điểm cuối thư viện (014 contracts/media-http-api.md mục 1, 7–10). `quota` khai báo TRƯỚC `:mediaId` để không bị
// nhận nhầm là mã media. Không điểm cuối nào trả đường dẫn công khai (FR-017).

@Controller('media')
export class LibraryController {
  constructor(@Inject(LibraryService) private readonly library: LibraryService) {}

  @Get('quota')
  @CustomerAccess('media.view')
  quota(): Promise<Quota> {
    return this.library.readQuota();
  }

  @Get()
  @CustomerAccess('media.view')
  list(@ValidQuery(ListQuery) query: ListQuery): Promise<ListResponse> {
    return this.library.list(query);
  }

  @Get(':mediaId')
  @CustomerAccess('media.view')
  get(@ValidParam(MediaIdParam) params: MediaIdParam): Promise<MediaDetail> {
    return this.library.get(params.mediaId);
  }

  @Get(':mediaId/usages')
  @CustomerAccess('media.view')
  usages(@ValidParam(MediaIdParam) params: MediaIdParam): Promise<UsagesResponse> {
    return this.library.usages(params.mediaId);
  }

  @Delete(':mediaId')
  @CustomerAccess('media.delete')
  @HttpCode(204)
  async remove(
    @ValidParam(MediaIdParam) params: MediaIdParam,
    @ValidQuery(DeleteQuery) query: DeleteQuery,
  ): Promise<void> {
    await this.library.remove(params.mediaId, query.confirm);
  }
}
