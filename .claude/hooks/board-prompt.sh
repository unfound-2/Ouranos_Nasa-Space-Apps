#!/usr/bin/env bash
# UserPromptSubmit hook: show board posts that arrived since the last check. Silent when none. Always exits 0.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
posts="$(tools/board unread 2>/dev/null)" || exit 0
[ -n "$posts" ] && printf 'New board posts (issue #%s):\n%s\n' "${BOARD_ISSUE:-1}" "$posts"
exit 0
