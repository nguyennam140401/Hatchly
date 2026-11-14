// Job `maintenance/prune-web` (008 T078, contracts/deploy-pipeline.md mục 4): hằng ngày, với mỗi môi trường ĐÃ có
// (provisioned: true), dọn assets của giao diện web không thuộc bản hiện hành / bản kích hoạt ≤ 7 ngày gần nhất.
// Cần khóa kho tệp tĩnh của từng môi trường → chạy như một bước của job môi trường: ở đây chỉ kích hoạt hai job con.
pipelineJob('deploy/staging/prune-web') {
    description('Dọn assets web cũ của staging (chỉ khi môi trường đã có).')
    triggers { cron('H 2 * * *') }
    logRotator { daysToKeep(90) }
    definition {
        cps {
            sandbox(true)
            script('''
                pipeline {
                  agent { label 'deploy' }
                  options { timeout(time: 10, unit: 'MINUTES'); timestamps() }
                  stages {
                    stage('Dọn assets') {
                      steps {
                        checkout([$class: 'GitSCM', branches: [[name: '*/dev']], userRemoteConfigs: [[url: 'https://github.com/nguyennam140401/Hatchly.git', credentialsId: 'github-app-deploy']]])
                        withCredentials([usernamePassword(credentialsId: 'static-site', usernameVariable: 'AWS_ACCESS_KEY_ID', passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                          sh 'set +x; corepack enable && pnpm install --frozen-lockfile && [ "$(node ops/deploy/scripts/env-get.mjs staging provisioned)" = "true" ] && node ops/deploy/scripts/publish-web.mjs --env staging --prune || echo "staging chưa có – bỏ qua"'
                        }
                      }
                    }
                  }
                }
            '''.stripIndent())
        }
    }
}

pipelineJob('deploy/production/prune-web') {
    description('Dọn assets web cũ của production (chỉ khi môi trường đã có).')
    triggers { cron('H 3 * * *') }
    logRotator { daysToKeep(90) }
    definition {
        cps {
            sandbox(true)
            script('''
                pipeline {
                  agent { label 'deploy' }
                  options { timeout(time: 10, unit: 'MINUTES'); timestamps() }
                  stages {
                    stage('Dọn assets') {
                      steps {
                        checkout([$class: 'GitSCM', branches: [[name: '*/master']], userRemoteConfigs: [[url: 'https://github.com/nguyennam140401/Hatchly.git', credentialsId: 'github-app-deploy']]])
                        withCredentials([usernamePassword(credentialsId: 'static-site', usernameVariable: 'AWS_ACCESS_KEY_ID', passwordVariable: 'AWS_SECRET_ACCESS_KEY')]) {
                          sh 'set +x; corepack enable && pnpm install --frozen-lockfile && [ "$(node ops/deploy/scripts/env-get.mjs production provisioned)" = "true" ] && node ops/deploy/scripts/publish-web.mjs --env production --prune || echo "production chưa có – bỏ qua"'
                        }
                      }
                    }
                  }
                }
            '''.stripIndent())
        }
    }
}
