{{- define "pg.labels" -}}
{{- range $k, $v := .Values.labels }}
{{ $k }}: {{ $v | quote }}
{{- end }}
data: "true"
component: database
{{- end -}}

{{/* Khối cấu hình S3 dùng chung cho ObjectStore (ghi và nguồn khôi phục). */}}
{{- define "pg.objectStoreSpec" -}}
configuration:
  destinationPath: {{ printf "s3://%s/" .Values.backup.bucket | quote }}
  endpointURL: {{ .Values.backup.endpoint | quote }}
  s3Credentials:
    accessKeyId:
      name: {{ .Values.backupSecretName }}
      key: ACCESS_KEY_ID
    secretAccessKey:
      name: {{ .Values.backupSecretName }}
      key: ACCESS_SECRET_KEY
  wal:
    compression: gzip
  data:
    compression: gzip
instanceSidecarConfiguration:
  env:
    - name: AWS_DEFAULT_REGION
      value: {{ .Values.backup.region | quote }}
    # vStorage không phải AWS: không bắt buộc tổng kiểm mới của SDK.
    - name: AWS_REQUEST_CHECKSUM_CALCULATION
      value: when_required
    - name: AWS_RESPONSE_CHECKSUM_VALIDATION
      value: when_required
{{- end -}}
