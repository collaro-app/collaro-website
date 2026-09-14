# Prepares the store screenshots for the web: downscales each image (aspect
# ratio preserved - nothing is cropped, stretched or otherwise altered) and
# writes it under docs/assets/img/screenshots/ with the language in the name,
# so the pages can reference `<name>.<lang>.<ext>` and a Hebrew page picks the
# Hebrew artwork automatically.
#
# Source naming (the store export):   map.png (English)   map-HE.png (Hebrew)
# Output naming (what the pages use): map.en.jpg          map.he.jpg
#
# Also writes the Open Graph image (a downscaled copy of the English feature
# banner) to docs/assets/img/og/og-image.jpg.
#
# Windows PowerShell 5.1 (System.Drawing), no other dependencies:
#   powershell -ExecutionPolicy Bypass -File scripts/optimize-screenshots.ps1 -Source "C:\path\to\store-screenshots"
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [int]$PortraitWidth = 828,   # 2x the widest on-page display size (~414 CSS px)
  [int]$BannerWidth = 1600,    # 2x the hero banner's display size
  [int]$Quality = 88
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "docs\assets\img\screenshots"
$ogDir = Join-Path $root "docs\assets\img\og"
New-Item -ItemType Directory -Force $outDir | Out-Null
New-Item -ItemType Directory -Force $ogDir | Out-Null

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $Quality

function Save-Scaled([string]$from, [string]$to, [int]$width) {
  $img = [System.Drawing.Image]::FromFile($from)
  $w = [Math]::Min($width, $img.Width)
  $h = [int][Math]::Round($img.Height * $w / $img.Width)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($img, 0, 0, $w, $h)
  $bmp.Save($to, $jpegCodec, $encoderParams)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  "{0,-28} {1}x{2}  {3,6:N0} KB" -f (Split-Path -Leaf $to), $w, $h, ((Get-Item $to).Length / 1KB)
}

$names = @('map', 'dogs', 'booking-flow', 'booking-details', 'chat', 'services', 'dashboard')
foreach ($name in $names) {
  foreach ($lang in @(@('en', "$name.png"), @('he', "$name-HE.png"))) {
    $from = Join-Path $Source $lang[1]
    if (-not (Test-Path $from)) { Write-Warning "missing $from - skipped"; continue }
    Save-Scaled $from (Join-Path $outDir "$name.$($lang[0]).jpg") $PortraitWidth
  }
}
foreach ($lang in @(@('en', 'feature-banner.png'), @('he', 'feature-banner-HE.png'))) {
  $from = Join-Path $Source $lang[1]
  if (-not (Test-Path $from)) { Write-Warning "missing $from - skipped"; continue }
  Save-Scaled $from (Join-Path $outDir "feature-banner.$($lang[0]).jpg") $BannerWidth
}
$banner = Join-Path $Source 'feature-banner.png'
if (Test-Path $banner) { Save-Scaled $banner (Join-Path $ogDir 'og-image.jpg') 1200 }
