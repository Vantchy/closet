# 下载 @imgly/background-removal 所需的模型/wasm 文件到 public/models/bg-removal/
# 用法：在项目根目录执行  powershell -ExecutionPolicy Bypass -File scripts/download-bg-models.ps1
# 仅下载默认配置实际使用的资源：isnet_fp16 模型 + onnxruntime wasm（jsep 与非 jsep 两套）。
# 文件为二进制大文件，已在 .gitignore 中忽略；新环境克隆仓库后运行本脚本一次即可离线使用。

$ErrorActionPreference = "Stop"

$Base = "https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist"
$OutDir = Join-Path $PSScriptRoot "..\public\models\bg-removal"
$NeededKeys = @(
  "/models/isnet_fp16",
  "/models/isnet",
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs",
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs"
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$resourcesPath = Join-Path $OutDir "resources.json"
Write-Host "下载 resources.json ..."
Invoke-WebRequest -Uri "$Base/resources.json" -OutFile $resourcesPath -TimeoutSec 60

$resources = Get-Content $resourcesPath -Raw | ConvertFrom-Json

$jobs = @()
foreach ($key in $NeededKeys) {
  $entry = $resources.$key
  if (-not $entry) { throw "resources.json 中缺少 $key" }
  foreach ($chunk in $entry.chunks) {
    $jobs += [pscustomobject]@{
      Key      = $key
      Name     = $chunk.name
      Expected = $chunk.offsets[1] - $chunk.offsets[0]
    }
  }
}

$total = $jobs.Count
$i = 0
$failed = @()
foreach ($job in $jobs) {
  $i += 1
  $dest = Join-Path $OutDir $job.Name
  if (Test-Path $dest) {
    $existing = (Get-Item $dest).Length
    if ($existing -eq $job.Expected) {
      Write-Host "[$i/$total] 已存在，跳过: $($job.Name.Substring(0,12))... ($existing bytes)"
      continue
    }
  }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Write-Host "[$i/$total] 下载 $($job.Key) 块 $($job.Name.Substring(0,12))... (尝试 $attempt)"
      Invoke-WebRequest -Uri "$Base/$($job.Name)" -OutFile $dest -TimeoutSec 300
      $actual = (Get-Item $dest).Length
      if ($actual -ne $job.Expected) {
        throw "大小不匹配: 期望 $($job.Expected)，实际 $actual"
      }
      break
    } catch {
      Write-Warning "失败: $($_.Exception.Message)"
      if ($attempt -eq 3) { $failed += $job.Name }
      else { Start-Sleep -Seconds 2 }
    }
  }
}

Write-Host ""
if ($failed.Count -gt 0) {
  Write-Warning "以下文件下载失败，请重新运行本脚本续传："
  $failed | ForEach-Object { Write-Warning "  $_" }
  exit 1
}
Write-Host "全部完成：$total 个文件已就绪于 $OutDir"
