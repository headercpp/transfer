Add-Type -AssemblyName System.Drawing

$sizes = @(512, 256, 128, 64, 48, 32, 16)
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Draw-Icon($size, $outPath) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $s = $size / 512.0

  # Rounded square background with gradient
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $radius = [int](112 * $s)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($rect.X, $rect.Y, $radius * 2, $radius * 2, 180, 90)
  $path.AddArc($rect.Right - $radius * 2, $rect.Y, $radius * 2, $radius * 2, 270, 90)
  $path.AddArc($rect.Right - $radius * 2, $rect.Bottom - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $path.CloseFigure()

  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.ColorTranslator]::FromHtml("#1a1a1c")), ([System.Drawing.ColorTranslator]::FromHtml("#2d2d30")), 45
  $g.FillPath($bgBrush, $path)

  # Subtle accent glow
  $glowRect = New-Object System.Drawing.RectangleF ([float](96 * $s)), ([float](96 * $s)), ([float](320 * $s)), ([float](320 * $s))
  $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glowPath.AddEllipse($glowRect)
  $glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
  $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(45, 180, 167, 255)
  $glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 143, 224, 163))
  $g.FillEllipse($glowBrush, $glowRect)

  # Arrows
  $penWidth = [float](28 * $s)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#f5f5f5")), $penWidth
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  # Up arrow (left)
  $g.DrawLine($pen, [float](186 * $s), [float](356 * $s), [float](186 * $s), [float](196 * $s))
  $g.DrawLine($pen, [float](186 * $s), [float](196 * $s), [float](136 * $s), [float](246 * $s))
  $g.DrawLine($pen, [float](186 * $s), [float](196 * $s), [float](236 * $s), [float](246 * $s))

  # Down arrow (right)
  $g.DrawLine($pen, [float](326 * $s), [float](156 * $s), [float](326 * $s), [float](316 * $s))
  $g.DrawLine($pen, [float](326 * $s), [float](316 * $s), [float](276 * $s), [float](266 * $s))
  $g.DrawLine($pen, [float](326 * $s), [float](316 * $s), [float](376 * $s), [float](266 * $s))

  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Host "Gerado: $outPath ($size x $size)"
}

# Main icon.png (512)
Draw-Icon 512 (Join-Path $outDir "icon.png")

# Individual sizes for ICO assembly
$iconDir = Join-Path $outDir "icon-sizes"
if (-not (Test-Path $iconDir)) { New-Item -ItemType Directory -Path $iconDir | Out-Null }
foreach ($s in $sizes) {
  Draw-Icon $s (Join-Path $iconDir "$s.png")
}

Write-Host ""
Write-Host "PNGs gerados. Agora execute: node build/makeIco.cjs"
