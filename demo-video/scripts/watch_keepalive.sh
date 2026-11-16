#!/bin/zsh
# Keep the OURANOS watch app in the foreground so it keeps sending its feed:
# watchOS returns to the clock after ~2 min without input. Runs for $1 minutes (default 40).
U=C1BD55F1-700A-44CE-BD7A-7E2CE000D71C
end=$(( $(date +%s) + ${1:-40} * 60 ))
while [ $(date +%s) -lt $end ]; do
  xcrun simctl launch $U com.nasaspaceapp.AstronautHealthSystem.watchkitapp >/dev/null 2>&1
  ~/.idb-venv/bin/idb ui tap --udid $U 8 185 >/dev/null 2>&1
  sleep 45
done
