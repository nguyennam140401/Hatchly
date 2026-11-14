// Job `maintenance/ruleset-drift` (008 R7): hằng ngày so luật bảo vệ nhánh đang áp trên GitHub với hai tệp ở
// ops/ci/github/rulesets/; lệch → báo Telegram ưu tiên cao kèm trường lệch. Chạy trên `deploy` (có mã bot).
// Cần mã cài đặt của GitHub App "ci" có quyền Administration: đọc (xem docs/ci-cd/credentials.md).
pipelineJob('maintenance/ruleset-drift') {
    description('So luật bảo vệ nhánh trên GitHub với kho; lệch thì báo Telegram.')
    triggers { cron('H 7 * * *') }
    logRotator { daysToKeep(90) }
    definition {
        cps {
            sandbox(true)
            script('''
                pipeline {
                  agent { label 'deploy' }
                  options { timeout(time: 5, unit: 'MINUTES'); timestamps() }
                  stages {
                    stage('So luật') {
                      steps {
                        checkout([$class: 'GitSCM', branches: [[name: '*/master']], userRemoteConfigs: [[url: 'https://github.com/nguyennam140401/Hatchly.git', credentialsId: 'github-app-ci']]])
                        withCredentials([
                          usernamePassword(credentialsId: 'github-app-ci', usernameVariable: 'GITHUB_APP', passwordVariable: 'GITHUB_TOKEN'),
                          string(credentialsId: 'telegram-bot-token', variable: 'TELEGRAM_BOT_TOKEN'),
                          string(credentialsId: 'telegram-chat-id', variable: 'TELEGRAM_CHAT_ID')
                        ]) {
                          script {
                            def code = sh(returnStatus: true, script: 'node ops/ci/scripts/ruleset-drift.mjs')
                            if (code == 1) { unstable('Luật bảo vệ nhánh lệch so với kho') }
                            else if (code != 0) { error('Không đọc được luật từ GitHub') }
                          }
                        }
                      }
                    }
                  }
                }
            '''.stripIndent())
        }
    }
}
