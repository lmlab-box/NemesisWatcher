$root = 'E:\Claude\Other Jobs\NemesisWatcher'
$prefix = 'http://127.0.0.1:8787/'
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "serving $root at $prefix"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $res.Headers.Add('Access-Control-Allow-Origin', '*')
  $res.Headers.Add('Cache-Control', 'no-store')
  $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')

  if ($path -eq 'proxy') {
    $target = $req.QueryString['url']
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $target -TimeoutSec 30 -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
      $bytes = [Text.Encoding]::UTF8.GetBytes($r.Content)
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "PROXY 200 $target ($($bytes.Length) bytes)"
    } catch {
      $res.StatusCode = 502
      $msg = [Text.Encoding]::UTF8.GetBytes("proxy error: $($_.Exception.Message)")
      $res.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "PROXY ERR $target :: $($_.Exception.Message)"
    }
    $res.OutputStream.Close()
    continue
  }

  if ($path -eq '') { $path = '_Testing/harness.html' }
  $full = Join-Path $root ($path -replace '/', '\')
  if (Test-Path -LiteralPath $full -PathType Leaf) {
    $ext = [IO.Path]::GetExtension($full).ToLower()
    $res.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
    $bytes = [IO.File]::ReadAllBytes($full)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    Write-Host "200 $path"
  } else {
    $res.StatusCode = 404
    Write-Host "404 $path"
  }
  $res.OutputStream.Close()
}
