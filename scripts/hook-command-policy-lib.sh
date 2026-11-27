#!/usr/bin/env bash
# Shared helpers for repo-local Claude/Codex command policy hooks.

hook_command_segments() {
  local command="$1"
  printf '%s\n' "$command" \
    | perl -0777 -pe "s/'[^']*'//g; s/\"(?:\\\\.|[^\"\\\\])*\"//g" \
    | perl -pe 's/&&|\|\||[;|]/\n/g'
}

hook_segment_uses_stack_wrapper() {
  grep -qE '(^|[[:space:]])(\./)?scripts/docker-local-stack\.sh\b'
}

hook_segment_uses_docker_exec() {
  grep -qE '(^|[[:space:]])docker[[:space:]]+exec\b'
}

hook_normalize_shell_prefix() {
  perl -pe '
    s/^\s+//;
    s/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+//;
    s/^env\s+(?:-\S+\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*//;
    s/^\s+//;
  '
}

hook_segment_has_direct_npm() {
  hook_normalize_shell_prefix \
    | grep -qE '^(npm[[:space:]]+(run|start|test|install|exec)\b|npx\b)'
}

hook_segment_has_direct_db_client() {
  hook_normalize_shell_prefix \
    | grep -qE '^(psql|pg_dump)\b'
}

hook_command_has_blocked_host_npm() {
  local command="$1"
  while IFS= read -r segment; do
    [ -n "${segment//[[:space:]]/}" ] || continue
    if printf '%s\n' "$segment" | hook_segment_has_direct_npm; then
      if ! printf '%s\n' "$segment" | hook_segment_uses_stack_wrapper \
        && ! printf '%s\n' "$segment" | hook_segment_uses_docker_exec; then
        return 0
      fi
    fi
  done < <(hook_command_segments "$command")
  return 1
}

hook_command_has_blocked_host_db_client() {
  local command="$1"
  while IFS= read -r segment; do
    [ -n "${segment//[[:space:]]/}" ] || continue
    if printf '%s\n' "$segment" | hook_segment_has_direct_db_client; then
      if ! printf '%s\n' "$segment" | hook_segment_uses_stack_wrapper; then
        return 0
      fi
    fi
  done < <(hook_command_segments "$command")
  return 1
}
