# Bộ điều khiển Jenkins (008, contracts/jenkins-platform.md mục 4). Ảnh nền cố định theo digest (R19);
# digest ứng với `jenkins/jenkins:lts-jdk21` (Jenkins 2.580.2) tra ngày 2026-11-13 – đổi qua pull request.
FROM jenkins/jenkins:lts-jdk21@sha256:74401de6a6f92e1afe1b02d1c8e3d0c33f263bfb5275dd8813f9150355f2367b

# Bộ điều khiển không chạy việc (numExecutors: 0) nên không cần Node/Docker ở đây – chỉ phần mở rộng.
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --latest false --plugin-file /usr/share/jenkins/ref/plugins.txt

# Tắt trình hướng dẫn cài đặt: toàn bộ cấu hình đến từ JCasC (casc/*.yaml), không cấu hình bằng giao diện.
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
ENV CASC_JENKINS_CONFIG=/var/jenkins_casc
