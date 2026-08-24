$ErrorActionPreference = 'Stop'

$outputDir = 'H:\ReplyLedgerDemo'
$repoDir = Split-Path -Parent $PSScriptRoot
$subtitleSource = Join-Path $PSScriptRoot 'demo-zh-TW.srt'
$subtitleTarget = Join-Path $outputDir 'demo-zh-TW.srt'
$rawNarration = Join-Path $outputDir 'narration.wav'
$timedNarration = Join-Path $outputDir 'narration-timed.wav'
$outputVideo = Join-Path $outputDir 'reply-ledger-demo-3min.mp4'

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
Copy-Item -LiteralPath $subtitleSource -Destination $subtitleTarget -Force

ffmpeg -y -i $rawNarration -filter:a 'atempo=1.11762' $timedNarration
if ($LASTEXITCODE -ne 0) { throw 'Failed to retime narration.' }

Push-Location $outputDir
try {
  $filter = @"
[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.00003,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=651:s=1920x1080:fps=30,setsar=1[v0];
[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.00002,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=2562:s=1920x1080:fps=30,setsar=1[v1];
[2:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.00003,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=579:s=1920x1080:fps=30,setsar=1[v2];
[3:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.00003,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=537:s=1920x1080:fps=30,setsar=1[v3];
[4:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.00003,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=387:s=1920x1080:fps=30,setsar=1[v4];
[5:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='min(zoom+0.00003,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=684:s=1920x1080:fps=30,setsar=1[v5];
[v0][v1][v2][v3][v4][v5]concat=n=6:v=1:a=0,subtitles=demo-zh-TW.srt:force_style='FontName=Microsoft JhengHei,FontSize=18,PrimaryColour=&H00F6F1E7,OutlineColour=&HAA000000,BackColour=&H88000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=30,Alignment=2'[video];
[6:a]apad=pad_dur=5,atrim=duration=180[audio]
"@ -replace "`r?`n", ''

  ffmpeg -y `
    -i '00-intro.png' `
    -i '01-workbench.png' `
    -i '02-inbox.png' `
    -i '03-knowledge.png' `
    -i '04-audit.png' `
    -i '00-intro.png' `
    -i 'narration-timed.wav' `
    -filter_complex $filter `
    -map '[video]' -map '[audio]' `
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p `
    -c:a aac -b:a 192k -movflags +faststart -t 180 `
    $outputVideo
  if ($LASTEXITCODE -ne 0) { throw 'Failed to render demo video.' }
}
finally {
  Pop-Location
}

ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 $outputVideo
