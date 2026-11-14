// Dọn ảnh phát hành cũ (008 T088, FR-025): hằng tuần, mỗi môi trường đã `provisioned`. Giữ ảnh của 10 lần triển khai
// release gần nhất và mọi ảnh dưới 90 ngày (luật ở ops/ci/scripts/prune-images.mjs). Cần thông tin `registry` của thư mục
// môi trường nên là job con của deploy/<môi trường>/; thông tin xác thực của hai môi trường không bao giờ lẫn.
def pruneJob = { String environment, String branch ->
    pipelineJob("deploy/${environment}/prune-images") {
        description("Dọn ảnh cũ của ${environment}: giữ 10 lần release gần nhất + ảnh dưới 90 ngày.")
        triggers { cron('H 4 * * 0') }
        logRotator { daysToKeep(90) }
        definition {
            cps {
                sandbox(true)
                script("""
                    pipeline {
                      agent { label 'deploy' }
                      options { timeout(time: 15, unit: 'MINUTES'); timestamps() }
                      stages {
                        stage('Dọn ảnh') {
                          steps {
                            checkout([\$class: 'GitSCM', branches: [[name: '*/${branch}']], userRemoteConfigs: [[url: 'https://github.com/nguyennam140401/Hatchly.git', credentialsId: 'github-app-deploy']]])
                            withCredentials([
                              usernamePassword(credentialsId: 'github-app-deploy', usernameVariable: 'GITHUB_APP', passwordVariable: 'GITHUB_TOKEN'),
                              usernamePassword(credentialsId: 'registry', usernameVariable: 'REGISTRY_USER', passwordVariable: 'REGISTRY_PASSWORD')
                            ]) {
                              sh 'set +x; corepack enable && pnpm install --frozen-lockfile && node ops/ci/scripts/prune-images.mjs --env ${environment} --apply'
                            }
                          }
                        }
                      }
                    }
                """.stripIndent())
            }
        }
    }
}

pruneJob('staging', 'dev')
pruneJob('production', 'master')
