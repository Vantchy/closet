# Download cloth-segmentation model (u2net_cloth_seg.onnx, ~176MB, hosted by rembg)
# and copy onnxruntime-web wasm runtime files into public/models/cloth-seg/.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/download-cloth-model.ps1
# Binary files are git-ignored; run once after clone.

$ErrorActionPreference = "Stop"

$OutDir = Join-Path $PSScriptRoot "..\public\models\cloth-seg"
$OrtOutDir = Join-Path $OutDir "ort"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path $OrtOutDir | Out-Null

# 1) Model weights (MD5 must match rembg v2.0.57 release)
$GhUrl = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_cloth_seg.onnx"
# GitHub 直连在国内常被限速到几 KB/s，优先用 ghfast.top 镜像（支持断点续传）
$UrlList = @(
  "https://ghfast.top/$GhUrl",
  $GhUrl,
  "https://ghproxy.net/$GhUrl"
)
$ModelDest = Join-Path $OutDir "u2net_cloth_seg.onnx"
$ExpectedMd5 = "2434d1f3cb744e0e49386c906e5a08bb"

function Test-Md5($path, $expected) {
  if (-not (Test-Path $path)) { return $false }
  $actual = (Get-FileHash -Path $path -Algorithm MD5).Hash.ToLower()
  return ($actual -eq $expected)
}

if (Test-Md5 $ModelDest $ExpectedMd5) {
  Write-Host "Model already exists and MD5 verified, skip download."
} else {
  # 清掉来源不明的半截文件，避免跨镜像续传出错
  if (Test-Path $ModelDest) { Remove-Item $ModelDest -Force }
  $ok = $false
  $curlLog = Join-Path $env:TEMP "cloth-model-curl.log"
  foreach ($url in $UrlList) {
    Write-Host "Downloading u2net_cloth_seg.onnx (~176MB) from $url ..."
    # curl.exe：-L 重定向，-C - 断点续传，--retry 传输层重试；
    # --silent 关闭进度条（stderr 输出在 $ErrorActionPreference=Stop 下会被 PowerShell 当成错误记录）
    # 错误信息仍落盘到 $curlLog 便于排查
    & curl.exe -L -C - --silent --show-error --retry 5 --retry-delay 3 `
      --connect-timeout 20 --max-time 3000 -o $ModelDest $url 2>$curlLog
    $code = $LASTEXITCODE
    if ($code -ne 0) {
      $detail = if (Test-Path $curlLog) { (Get-Content $curlLog -Raw -ErrorAction SilentlyContinue) } else { "" }
      Write-Warning "curl exit=$code ($($detail.Trim().Split("`n")[0]))"
    }
    if ($code -eq 0 -and (Test-Md5 $ModelDest $ExpectedMd5)) { $ok = $true; break }
    Write-Warning "This source failed or file incomplete, trying next mirror (resume supported)."
  }
  if (-not $ok) {
    $actual = if (Test-Path $ModelDest) { (Get-FileHash -Path $ModelDest -Algorithm MD5).Hash.ToLower() } else { "missing" }
    throw "Model download failed from all mirrors. Re-run the script later. md5=$actual"
  }
  Write-Host "Model downloaded and MD5 verified."
}

# 2) onnxruntime-web wasm runtime (webgpu/jsep + plain wasm)
$OrtSrc = Join-Path $PSScriptRoot "..\node_modules\onnxruntime-web\dist"
if (-not (Test-Path $OrtSrc)) {
  throw "onnxruntime-web not found at $OrtSrc; run npm install first."
}
$OrtFiles = @(
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs"
)
foreach ($f in $OrtFiles) {
  $src = Join-Path $OrtSrc $f
  $dst = Join-Path $OrtOutDir $f
  if (-not (Test-Path $src)) { throw "Missing onnxruntime-web file: $f" }
  $needCopy = $true
  if (Test-Path $dst) {
    if ((Get-Item $src).Length -eq (Get-Item $dst).Length) { $needCopy = $false }
  }
  if ($needCopy) {
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "Copied ort runtime: $f"
  } else {
    Write-Host "ort runtime already present, skip: $f"
  }
}

Write-Host ""
Write-Host "DONE: cloth segmentation model ready at $OutDir"
