{{/* Ảnh theo digest: repository@sha256:… (không dùng thẻ trôi). */}}
{{- define "app.image" -}}
{{ .Values.image.repository }}@{{ .Values.image.digest }}
{{- end -}}

{{/* Nhãn chung; app.kubernetes.io/version = SHA phiên bản đang triển khai. */}}
{{- define "app.labels" -}}
app.kubernetes.io/name: app
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.appVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Bối cảnh bảo mật chung: không root, hệ tệp gốc chỉ đọc, bỏ mọi capability. */}}
{{- define "app.securityContext" -}}
runAsNonRoot: true
runAsUser: 1000
readOnlyRootFilesystem: true
allowPrivilegeEscalation: false
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* Biến môi trường chung của api và worker. */}}
{{- define "app.env" -}}
- name: APP_VERSION
  value: {{ .Values.appVersion | quote }}
{{- end -}}
