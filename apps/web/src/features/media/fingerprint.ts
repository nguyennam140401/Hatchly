// Dấu vân tay tệp (014 R2): SHA-256 hex của `tên|dung lượng|lastModified` bằng WebCrypto – KHÔNG đọc nội dung tệp,
// không thêm thư viện. Dùng để máy chủ nhận lại phiên tải dở khi người dùng chọn lại đúng tệp đó.

export async function fingerprintOf(file: {
  name: string;
  size: number;
  lastModified: number;
}): Promise<string> {
  const data = new TextEncoder().encode(
    `${file.name}|${String(file.size)}|${String(file.lastModified)}`,
  );
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
