{{- define "war-room.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "war-room.labels" -}}
app.kubernetes.io/name: war-room
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.appVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "war-room.hasPersonas" -}}
{{- if .Files.Glob "files/personas/*/*.md" }}yes{{ end -}}
{{- end -}}
