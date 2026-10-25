{{- define "sre-teams.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "sre-teams.labels" -}}
app.kubernetes.io/name: sre-teams
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.appVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "sre-teams.hasPersonas" -}}
{{- if .Files.Glob "files/personas/*/*.md" }}yes{{ end -}}
{{- end -}}
