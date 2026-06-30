{{/*
Expand the name of the chart.
*/}}
{{- define "safequery.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "safequery.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels for a given component (pass component name as $.component).
*/}}
{{- define "safequery.selectorLabels" -}}
app.kubernetes.io/name: {{ .component }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Shared security context applied to every pod spec.
Non-root user (UID 1001 — matches the Dockerfiles' "node" user), read-only root
filesystem, all Linux capabilities dropped.
*/}}
{{- define "safequery.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 1001
runAsGroup: 1001
fsGroup: 1001
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/*
Shared container security context.
*/}}
{{- define "safequery.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop:
    - ALL
{{- end }}

{{/*
Image reference for a given app component.
Usage: {{ include "safequery.image" (dict "Values" .Values "app" .Values.api) }}
*/}}
{{- define "safequery.image" -}}
{{ .Values.global.image.registry }}/{{ .app.image.name }}:{{ .Values.global.image.tag }}
{{- end }}
