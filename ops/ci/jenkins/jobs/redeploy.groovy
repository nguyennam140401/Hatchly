// Hai job triển khai lại bản cũ (008 T085, FR-034, contracts/deploy-pipeline.md mục 6): `deploy/staging/redeploy`,
// `deploy/production/redeploy`. Chạy tay có tham số; không dựng ảnh, không chạy migration. Quyền chạy theo thư mục
// (folders.groovy + casc/security.yaml): production chỉ release-managers, staging thêm developers.
def redeployJob = { String environment, String branch ->
    pipelineJob("deploy/${environment}/redeploy") {
        description("Triển khai lại một bản đã từng thành công lên ${environment} (không dựng ảnh, không migration).")
        logRotator { daysToKeep(400) }
        parameters {
            stringParam('VERSION', '', 'SHA commit đã từng triển khai THÀNH CÔNG lên môi trường này')
            stringParam('REASON', '', 'Lý do triển khai lại (bắt buộc)')
            booleanParam('ACK_OLDER_THAN_PREVIOUS', false, 'Bắt buộc đánh dấu nếu VERSION không phải bản liền trước: tương thích ngược chỉ được kiểm với bản liền trước')
        }
        definition {
            cpsScm {
                scm {
                    git {
                        remote {
                            url('https://github.com/nguyennam140401/Hatchly.git')
                            credentials('github-app-deploy')
                        }
                        branch("*/${branch}")
                    }
                }
                scriptPath('ops/ci/Jenkinsfile.redeploy')
                lightweight(false)
            }
        }
    }
}

redeployJob('staging', 'dev')
redeployJob('production', 'master')
