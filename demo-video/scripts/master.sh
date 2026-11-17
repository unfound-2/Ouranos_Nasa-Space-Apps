#!/usr/bin/env bash
# Master the Remotion render: two-pass loudness normalization of the mix to -14 LUFS
# (true peak -1 dBTP), video stream copied untouched. Fails if the film is over 30 s (Space Apps limit).
# usage: scripts/master.sh <rendered.mp4> <final.mp4>
set -euo pipefail
in="$1"
out="$2"
stats=$(ffmpeg -hide_banner -nostats -i "$in" -vn -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | sed -n "s/.*\"$1\" : \"\(.*\)\".*/\1/p"; }
ffmpeg -v error -y -i "$in" -c:v copy -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true" \
  -ar 48000 -c:a aac -b:a 320k -shortest -movflags +faststart "$out"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
lufs=$(ffmpeg -hide_banner -nostats -i "$out" -vn -af ebur128 -f null - 2>&1 | sed -n 's/^ *I: *\(-*[0-9.]*\) LUFS/\1/p' | tail -1)
echo "[master] $out  duration ${dur}s  loudness ${lufs} LUFS"
awk -v d="$dur" 'BEGIN { if (d > 30) { print "[master] OVER 30 s: Space Apps limit, cut something"; exit 1 } }'
