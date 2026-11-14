// Job `ci/gates` (008 US1, R4/R5): Multibranch chỉ khám phá PULL REQUEST (kết quả hợp nhất dự kiến với nhánh đích),
// quét kho mỗi 10 phút làm dự phòng cho webhook. `Jenkinsfile.ci` luôn nạp từ nhánh TIN CẬY `dev` (phần mở rộng
// Remote Jenkinsfile Provider, plugins.txt) – pull request không sửa được định nghĩa quy trình. Kiểm tra `ci/gates` và
// `gate/<bước>` do GitHub App "ci" đăng (Jenkinsfile.ci → post-gate-checks.mjs).
// CHƯA kiểm chứng trên Jenkins thật (T053): nếu Remote Jenkinsfile Provider không nạp được thì dùng phương án dự phòng
// Pipeline Multibranch Defaults (xem docs/ci-cd/rebuild-jenkins.md).
multibranchPipelineJob('ci/gates') {
    displayName('ci/gates')
    description('Cổng chất lượng cho pull request nhắm dev / master. Kết quả hiện trên pull request dưới tên ci/gates.')
    branchSources {
        github {
            id('ci-gates-github')
            repoOwner('nguyennam140401')
            repository('Hatchly')
            scanCredentialsId('github-app-ci')
            checkoutCredentialsId('github-app-ci')
            // Chỉ pull request nhắm nhánh bất kỳ của kho này, theo kết quả hợp nhất với đích; KHÔNG build nhánh thường.
            buildOriginBranch(false)
            buildOriginBranchWithPR(false)
            buildOriginPRMerge(true)
            buildOriginPRHead(false)
            // Pull request từ fork: không build (kho riêng tư, không có fork; nếu mở public sẽ cần xem lại FR-007).
            buildForkPRMerge(false)
            buildForkPRHead(false)
        }
    }
    configure { node ->
        // Nạp Jenkinsfile từ `dev` (tin cậy) thay vì từ pull request.
        def factory = node / factory(class: 'org.jenkinsci.plugins.workflow.multibranch.RemoteJenkinsFileWorkflowBranchProjectFactory')
        factory / owner(class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject', reference: '../..')
        factory / remoteJenkinsFile('ops/ci/Jenkinsfile.ci')
        factory / matchBranches('false')
        factory / fallbackBranch('dev')
        factory / localMarker('')
    }
    triggers {
        // Dự phòng khi webhook mất (R5): quét kho mỗi 10 phút.
        periodicFolderTrigger { interval('10m') }
    }
    orphanedItemStrategy {
        discardOldItems { daysToKeep(30); numToKeep(200) }
    }
}
