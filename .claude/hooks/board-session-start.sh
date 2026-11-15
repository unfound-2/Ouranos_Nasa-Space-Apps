#!/usr/bin/env bash
# SessionStart hook: show unread board posts and the board rules. Always exits 0.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
posts="$(tools/board unread 2>&1)" || posts="(board unreachable: $(printf '%s' "$posts" | head -n 1)). Run tools/board unread later."
echo "Team board: GitHub issue #${BOARD_ISSUE:-1}. Rules, including the Space Apps rules every agent must follow, are in AGENTS.md."
if [ -n "$posts" ]; then
  echo "Unread posts:"
  echo "$posts"
else
  echo "No unread posts."
fi
if [ "${BOARD_WAIT:-off}" = "on" ]; then
  echo "BOARD_WAIT=on: keep ONE background Bash command running: tools/board wait. When it returns, handle the posts (a MENTION means act and reply on the board), then start it again."
else
  echo "New posts are shown on every prompt. Also run tools/board unread before each commit and after each merge. Do not start a background tools/board wait unless BOARD_WAIT=on."
fi
exit 0
