// Job tay `ci/sandbox` (008 R4): SA thử `Jenkinsfile.ci` của MỘT nhánh trước khi hợp nhất vào `dev`. Kết quả báo dưới
// tên `ci/sandbox` (KHÔNG phải tên bắt buộc của ruleset) nên không thể dùng để vượt cổng. Chỉ người có vai release-manager
// chạy được (quyền theo thư mục ở folders.groovy). Tham số BRANCH: nhánh chứa Jenkinsfile.ci cần thử.
pipelineJob('ci/sandbox') {
    description('Thử Jenkinsfile.ci của một nhánh (không phải kiểm tra bắt buộc). Chạy tay bởi SA.')
    parameters { stringParam('BRANCH', 'dev', 'Nhánh chứa ops/ci/Jenkinsfile.ci cần thử') }
    logRotator { daysToKeep(30); numToKeep(50) }
    definition {
        cpsScm {
            scm {
                git {
                    remote {
                        url('https://github.com/nguyennam140401/Hatchly.git')
                        credentials('github-app-ci')
                    }
                    branch('${BRANCH}')
                }
            }
            scriptPath('ops/ci/Jenkinsfile.ci')
            lightweight(false)
        }
    }
}
