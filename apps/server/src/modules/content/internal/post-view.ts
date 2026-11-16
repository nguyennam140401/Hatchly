// Chuyển bản ghi bài sang hình dạng phản hồi API (contracts/http-api.md mục 3). Hàm THUẦN.
import {
  postTitle,
  type ChannelStatusValue,
  type Post,
  type PostLabels,
  type PostSummary,
  type ValidationIssue,
} from '@app/shared/content';
import type { PostRecord } from '../public-api';

export interface ChannelInfo {
  status: ChannelStatusValue;
  displayName: string | null;
}

/** "Giờ đã qua": bài chưa duyệt có giờ dự kiến sớm hơn now()+lead (FR-011, data-model mục 5). */
export function isTimePassed(post: PostRecord, now: Date, leadMinutes: number): boolean {
  if (post.status !== 'draft' && post.status !== 'pending_review') return false;
  if (post.scheduledAt === null) return false;
  return post.scheduledAt.getTime() < now.getTime() + leadMinutes * 60_000;
}

export function labelsOf(post: PostRecord, now: Date, leadMinutes: number): PostLabels {
  return {
    returned:
      post.returnedNote === null
        ? null
        : {
            note: post.returnedNote,
            byUserId: post.returnedBy,
            at: post.returnedAt?.toISOString() ?? null,
          },
    editedAfterApproval: post.editedAfterApproval,
    timePassed: isTimePassed(post, now, leadMinutes),
  };
}

export function toPostView(
  post: PostRecord,
  channels: ReadonlyMap<string, ChannelInfo>,
  issues: ReadonlyMap<string, ValidationIssue[]>,
  now: Date,
  leadMinutes: number,
): Post {
  return {
    id: post.id,
    status: post.status,
    source: post.source,
    internalName: post.internalName,
    title: postTitle(post.internalName, post.sharedText),
    sharedText: post.sharedText,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    version: post.version,
    labels: labelsOf(post, now, leadMinutes),
    createdBy: post.createdBy,
    submittedBy: post.submittedBy,
    approvedBy: post.approvedBy,
    approvedAt: post.approvedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    variants: post.variants.map((v) => ({
      id: v.id,
      connectionId: v.connectionId,
      channelType: v.channelType,
      channelDisplayName: channels.get(v.connectionId)?.displayName ?? null,
      channelStatus: channels.get(v.connectionId)?.status ?? 'unknown',
      customized: v.customized,
      text: v.text,
      hashtags: v.hashtags,
      media: v.media,
      version: v.version,
      issues: issues.get(v.connectionId) ?? [],
    })),
  };
}

export function toSummaryView(post: PostRecord, now: Date, leadMinutes: number): PostSummary {
  return {
    id: post.id,
    status: post.status,
    title: postTitle(post.internalName, post.sharedText),
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    version: post.version,
    labels: labelsOf(post, now, leadMinutes),
    channelTypes: post.variants.map((v) => v.channelType),
    updatedAt: post.updatedAt.toISOString(),
  };
}
