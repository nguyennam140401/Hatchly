// Hai job triển khai (008 US2, contracts/deploy-pipeline.md mục 1): `deploy/staging/deploy` chỉ nhánh `dev`,
// `deploy/production/deploy` chỉ nhánh `master`. Mỗi job lấy `ops/ci/Jenkinsfile.deploy` từ CHÍNH nhánh đó (mã đã hợp
// nhất, đã qua `ci/gates`). Kích hoạt: webhook `push` + thăm dò 5 phút phòng webhook mất (R5). Khóa theo môi trường ở
// Jenkinsfile.deploy (`lock("deploy-<env>")`, Lockable Resources). Giữ lần chạy 400 ngày (FR-036).
// Nhắc: production chỉ `release-manager` chạy tay được (quyền theo thư mục ở folders.groovy).
def deployJob = { String environment, String branch ->
    pipelineJob("deploy/${environment}/deploy") {
        description("Triển khai nhánh ${branch} lên môi trường ${environment}. Tự chạy khi nhánh có commit mới; không có bước chờ xác nhận.")
        logRotator { daysToKeep(400) }
        triggers {
            githubPush()
            scm('H/5 * * * *')
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
                scriptPath('ops/ci/Jenkinsfile.deploy')
                lightweight(false)
            }
        }
    }
}

deployJob('staging', 'dev')
deployJob('production', 'master')

// Khóa `deploy-staging` / `deploy-production` do bước `lock(...)` của Jenkinsfile.deploy tự tạo khi cần.
