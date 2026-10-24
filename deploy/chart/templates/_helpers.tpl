{{- define "sre-teams.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "sre-teams.labels" -}}
app.kubernetes.io/name: sre-teams
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
