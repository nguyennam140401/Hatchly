# Triển khai khẩn cấp khi Jenkins ngừng hoạt động

Khi Jenkins ngừng, **ứng dụng ở hai môi trường không bị ảnh hưởng** – chỉ không có bản mới nào tự lên. Hợp nhất bị khóa vì
`ci/gates` không được báo về (đúng ý). Chỉ dùng tài liệu này khi cần phát hành khẩn **và** chưa kịp dựng lại Jenkins
([rebuild-jenkins.md](rebuild-jenkins.md), ≤ 4 giờ).

Người làm: SA (có vai `release-manager`), từ máy của mình, dùng **đúng các tập lệnh mà Jenkins dùng** – nên kết quả
giống nhau. Cần: `node` (đúng `NODE_VERSION` trong `ops/ci/versions.env`), `pnpm`, `docker`, `helm`, `kubectl`, `trivy`
(đúng phiên bản ở `versions.env`), cùng thông tin xác thực của môi trường (giữ ở nơi SA cất bí mật, **không** lấy từ kho).

> Chưa từng diễn tập tài liệu này (T098 chờ môi trường thật từ tính năng 007). Sau lần diễn tập đầu, ghi vào "Lịch sử
> diễn tập" bên dưới.

## Thứ tự bước (giống `Jenkinsfile.deploy`, mục 2 của contracts/deploy-pipeline.md)

Đặt biến cho môi trường (`ENV_NAME=staging|production`) và commit cần phát hành (`SHA=<40 ký tự>`), đứng ở thư mục gốc
kho đã `git switch` đúng nhánh (`dev` cho staging, `master` cho production):

1. **Cổng** – `pnpm install --frozen-lockfile && pnpm verify --ci` (đầy đủ, cần PostgreSQL tạm). Đỏ → **dừng**, không phát hành.
2. **Ảnh** – `node ops/deploy/scripts/release-image.mjs --repository <registry.repository> --sha $SHA --policy <block|warn theo vulnerabilityPolicy>`
   (cần `docker login` vào kho ảnh của môi trường). Ghi lại `digest` in ra.
3. **Migration** – dựng Job từ `ops/deploy/migrate-job.yaml` bằng `envsubst` (xem biến ở đầu tệp), `kubectl apply`, chờ
   `kubectl wait --for=condition=complete job/migrate-<sha12>`. Lỗi → **dừng** (ứng dụng chưa đổi).
4. **Rollout** – `node ops/deploy/scripts/render-values.mjs --env $ENV_NAME --sha $SHA --digest <digest> > values.yaml` rồi
   `HELM_DRIVER=configmap helm upgrade --install app ops/deploy/chart -n <namespace app> -f values.yaml --atomic --wait --timeout 8m`.
   Ghi lại `helm history app` **trước** khi chạy để biết bản trước.
5. **Web** – `node ops/deploy/scripts/publish-web.mjs --env $ENV_NAME --sha $SHA` rồi `… --activate`.
6. **Kiểm tra khói** – `node ops/deploy/smoke/smoke.mjs --env $ENV_NAME --expect-version $SHA` (cần `SMOKE_TOKEN`,
   `SMOKE_USER`, `SMOKE_PASSWORD`). Hỏng → quay về: `helm rollback app <bản trước> --wait` và
   `node ops/deploy/scripts/publish-web.mjs --env $ENV_NAME --rollback-to <sha trước>`.

Mọi bước chạy lại được an toàn: ảnh dùng lại theo thẻ, Job migration theo tên, `helm upgrade` cùng digest là không đổi.

## Giữ lịch sử không đứt

Sau khi xong, tạo **tay** một GitHub Deployment để trang Environments vẫn đủ lịch sử (contracts/jenkins-platform.md mục 8):

```powershell
gh api repos/<chủ>/<kho>/deployments -f ref=$SHA -f environment=$ENV_NAME -F auto_merge=false `
  -f description="manual: triển khai khẩn cấp khi Jenkins ngừng – <lý do>"
gh api repos/<chủ>/<kho>/deployments/<id>/statuses -f state=success
```

(Dùng `failure` nếu đã quay về.) Mô tả **phải** bắt đầu bằng `manual:` và nêu lý do. Khi Jenkins chạy lại, lần triển khai
kế tiếp tự nối tiếp từ bản ghi này.

## Lịch sử diễn tập

| Ngày        | Người làm | Môi trường | Thời gian | Điều đã sửa trong tài liệu |
| ----------- | --------- | ---------- | --------- | -------------------------- |
| _(chưa có)_ |           |            |           |                            |
