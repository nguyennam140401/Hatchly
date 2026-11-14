// Job `maintenance/credential-age` (008, FR-040): hằng ngày báo Telegram khi thông tin xác thực quá 90 ngày
// chưa xoay. Chạy trên tác nhân `deploy` (cần mã bot ở thư mục deploy/). Script: ops/ci/scripts/credential-age.mjs.
pipelineJob('maintenance/credential-age') {
    description('Báo Telegram khi thông tin xác thực quá 90 ngày chưa xoay (chỉ đọc tên + ngày, không đọc giá trị).')
    triggers { cron('H 8 * * *') }
    logRotator { daysToKeep(90) }
    definition {
        cps {
            sandbox(true)
            script('''
                pipeline {
                  agent { label 'deploy' }
                  options { timeout(time: 5, unit: 'MINUTES'); timestamps() }
                  stages {
                    stage('Kiểm tra tuổi') {
                      steps {
                        checkout([$class: 'GitSCM', branches: [[name: '*/master']], userRemoteConfigs: [[url: 'https://github.com/nguyennam140401/Hatchly.git', credentialsId: 'github-app-ci']]])
                        withCredentials([
                          string(credentialsId: 'telegram-bot-token', variable: 'TELEGRAM_BOT_TOKEN'),
                          string(credentialsId: 'telegram-chat-id', variable: 'TELEGRAM_CHAT_ID')
                        ]) {
                          // Quá hạn → script thoát mã 1 và đã gửi Telegram; đánh dấu UNSTABLE thay vì FAILURE.
                          script {
                            def code = sh(returnStatus: true, script: 'node ops/ci/scripts/credential-age.mjs')
                            if (code != 0) { unstable('Có thông tin xác thực quá hạn xoay') }
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
