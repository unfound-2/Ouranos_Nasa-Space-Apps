#!/bin/zsh
# Final encode from a screencast frame folder (list.txt from web_session.cjs):
# CFR 30 fps, 1920x1080, H.264 High, crf 12, BT.709 limited range.
# usage: encode_frames.sh <frames_dir> <out.mp4> <start_s> <duration_s>
set -e
dir=$1; out=$2; start=${3:-0}; dur=${4:-600}
ffmpeg -y -loglevel error -f concat -safe 0 -i "$dir/list.txt" \
  -vf "fps=30,trim=start=${start}:duration=${dur},setpts=PTS-STARTPTS,scale=1920:1080:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p" \
  -c:v libx264 -preset slow -crf 12 -profile:v high -r 30 -fps_mode cfr \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -movflags +faststart -an "$out"
ffprobe -v error -show_entries stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt,profile -show_entries format=duration -of compact "$out"
