import { Controller, Get, HttpCode, Inject, Put } from '@nestjs/common';
import {
  SaveProfileRequest,
  VersionIdParam,
  VersionListQuery,
  type GetProfileResponse,
  type SaveProfileResponse,
  type VersionDetailResponse,
  type VersionListResponse,
} from '@app/shared/context';
import { CustomerAccess, requireCustomer, ValidBody, ValidParam, ValidQuery } from '../../../core';
import { ProfileService } from './profile.service';

// Điểm cuối hồ sơ kinh doanh (006 contracts/context-http-api.md) – MẪU cho controller nghiệp vụ:
// - MỖI handler có đúng một khai báo truy cập (@CustomerAccess + quyền) – quyền kiểm ở API.
// - Đầu vào chỉ qua @ValidBody/@ValidQuery/@ValidParam với lược đồ dùng chung (web dùng cùng lược đồ).
// - Mã tài khoản và người dùng CHỈ lấy từ phiên (guard đã gắn) – không bao giờ từ đầu vào.

@Controller('context/profile')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  @CustomerAccess('context.view')
  getProfile(): Promise<GetProfileResponse> {
    return this.profiles.getProfile();
  }

  @Put()
  @CustomerAccess('context.edit')
  @HttpCode(200)
  saveProfile(
    @ValidBody(SaveProfileRequest) body: SaveProfileRequest,
  ): Promise<SaveProfileResponse> {
    const actor = requireCustomer();
    return this.profiles.saveProfile(body.expectedVersion, body.fields, actor.userId);
  }

  @Get('versions')
  @CustomerAccess('context.view')
  listVersions(
    @ValidQuery(VersionListQuery) query: VersionListQuery,
  ): Promise<VersionListResponse> {
    return this.profiles.listVersions(query.page);
  }

  @Get('versions/:versionId')
  @CustomerAccess('context.view')
  getVersion(@ValidParam(VersionIdParam) params: VersionIdParam): Promise<VersionDetailResponse> {
    return this.profiles.getVersion(params.versionId);
  }
}
