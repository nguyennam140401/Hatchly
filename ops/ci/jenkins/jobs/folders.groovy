// Thư mục của Jenkins + quyền theo thư mục + thời gian giữ lần chạy (008, contracts/jenkins-platform.md mục 5, 7).
// Thông tin xác thực gắn vào từng thư mục ở casc/credentials.yaml; ở đây chỉ dựng thư mục và quyền.
//   ci/                   chặng kiểm tra – mã pull request chưa review, KHÔNG thấy thông tin triển khai nào
//   deploy/               chặng triển khai (mã đã hợp nhất)
//   deploy/staging/       môi trường test
//   deploy/production/    môi trường release – developers KHÔNG chạy tay / chạy lại được
//   maintenance/          việc định kỳ (dọn ảnh, tuổi thông tin xác thực…)
// Người dùng khớp casc/security.yaml; thêm người = sửa cả hai nơi và ops/ci/team.json.
def releaseManagers = ['nguyennam140401']
def developers = ['nguyennam140401']

def grant = { delegate_, List<String> users, List<String> permissions ->
    users.each { user ->
        permissions.each { permission -> delegate_.permission(permission, user) }
    }
}

folder('ci') {
    description('Chặng kiểm tra: chạy cổng chất lượng trên mã pull request. Không có thông tin triển khai.')
    authorization {
        grant(delegate, developers + releaseManagers, ['hudson.model.Item.Read', 'hudson.model.Item.Build', 'hudson.model.Item.Cancel', 'hudson.model.Run.Replay'])
    }
}

folder('deploy') {
    description('Chặng triển khai: chạy mã đã hợp nhất vào dev / master.')
    authorization {
        grant(delegate, developers + releaseManagers, ['hudson.model.Item.Read'])
    }
}

folder('deploy/staging') {
    description('Môi trường test (staging) – nhánh dev.')
    authorization {
        grant(delegate, developers + releaseManagers, ['hudson.model.Item.Read', 'hudson.model.Item.Build', 'hudson.model.Item.Cancel', 'hudson.model.Run.Replay'])
    }
}

folder('deploy/production') {
    description('Môi trường release (production) – nhánh master. Chỉ release-manager chạy tay / chạy lại.')
    authorization {
        // developers chỉ XEM; Build / Replay chỉ cho release-manager (FR-038, US4-AS2).
        grant(delegate, developers, ['hudson.model.Item.Read'])
        grant(delegate, releaseManagers, ['hudson.model.Item.Read', 'hudson.model.Item.Build', 'hudson.model.Item.Cancel', 'hudson.model.Run.Replay'])
    }
}

folder('maintenance') {
    description('Việc định kỳ: dọn ảnh, tuổi thông tin xác thực.')
    authorization {
        grant(delegate, releaseManagers, ['hudson.model.Item.Read', 'hudson.model.Item.Build'])
    }
}
