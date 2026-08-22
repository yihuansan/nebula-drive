# 星云网盘 功能测试（修复后验证）
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8080/api/v1'
$script:pass = 0; $script:fail = 0
function Check([string]$name, [bool]$cond, [string]$detail = '') {
  if ($cond) { $script:pass++; Write-Output "  [PASS] $name" }
  else { $script:fail++; Write-Output "  [FAIL] $name :: $detail" }
}

Write-Output '== 1. 登录 devtest =='
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -Body '{"username":"devtest","password":"test123456"}' -ContentType 'application/json'
$token = $login.data.token
$H = @{ Authorization = "Bearer $token" }
Write-Output ("  login data: {0}" -f ($login.data | ConvertTo-Json -Compress))

Write-Output '== 2. GET /storages（user 角色，修复后应 200）=='
try {
  $st = Invoke-RestMethod -Uri "$base/storages" -Headers $H
  Check 'storages 200' ($null -ne $st.data.storages) ("count=$($st.data.storages.Count)")
  $st.data.storages | ForEach-Object { Write-Output ("    id={0} name={1} enabled={2}" -f $_.id, $_.name, $_.enabled) }
} catch { Check 'storages 200' $false $_.Exception.Message }

Write-Output '== 3. GET /files?storageId=1 =='
$files = Invoke-RestMethod -Uri "$base/files?storageId=1" -Headers $H
Check 'files 列表' ($null -ne $files.data.entries) ("count=$($files.data.entries.Count)")
$files.data.entries | Select-Object -First 5 | ForEach-Object { Write-Output ("    {0} isDir={1} size={2}" -f $_.name, $_.isDir, $_.size) }

Write-Output '== 4. transfers：POST + GET（camelCase，仅本人）=='
$tp = Invoke-RestMethod -Method Post -Uri "$base/transfers" -Headers $H -Body '{"shareUrl":"https://example.com/s/qa-test"}' -ContentType 'application/json'
Check 'transfers POST' ($tp.data.transferred -eq 0) ($tp | ConvertTo-Json)
$gt = Invoke-RestMethod -Uri "$base/transfers" -Headers $H
$last = $gt.data.transfers | Select-Object -First 1
Check 'transfers GET camelCase' ($null -ne $last.shareUrl -and $null -ne $last.createdAt) (($last | ConvertTo-Json) 2>$null)
Write-Output ("    rows={0} first={1}" -f (@($gt.data.transfers).Count), ($last | ConvertTo-Json))

Write-Output '== 5. GET /subscriptions（camelCase）=='
$gs = Invoke-RestMethod -Uri "$base/subscriptions" -Headers $H
Check 'subscriptions 200' ($null -ne $gs.data.subscriptions) ("count=$($gs.data.subscriptions.Count)")

Write-Output '== 6. quick-access：含 % 文件名 + camelCase + 取消固定 =='
$testFile = 'D:\项目\cloud网盘系统\apps\server\storage\test%file.txt'
Set-Content -Path $testFile -Value 'qa test' -Encoding utf8
try {
  $qa1 = Invoke-RestMethod -Method Post -Uri "$base/files/quick-access/test%25file.txt?storageId=1" -Headers $H -Body '{}' -ContentType 'application/json'
  Check 'POST % 文件名不 500' ($qa1.data.action -eq 'added') (($qa1 | ConvertTo-Json) 2>$null)
  $qa2 = Invoke-RestMethod -Uri "$base/files/quick-access?storageId=1" -Headers $H
  $qaEntry = $qa2.data.entries | Where-Object { $_.path -eq '/test%file.txt' }
  Check 'GET camelCase + size' (($null -ne $qaEntry) -and ($null -ne $qaEntry.size)) (($qaEntry | ConvertTo-Json) 2>$null)
  $qa3 = Invoke-RestMethod -Method Post -Uri "$base/files/quick-access/test%25file.txt?storageId=1" -Headers $H -Body '{}' -ContentType 'application/json'
  Check 'POST 取消固定' ($qa3.data.action -eq 'removed') (($qa3 | ConvertTo-Json) 2>$null)
} finally {
  Remove-Item $testFile -ErrorAction SilentlyContinue
}

Write-Output '== 7. GET /files/recent（camelCase）=='
$rec = Invoke-RestMethod -Uri "$base/files/recent?storageId=1" -Headers $H
$recFirst = $rec.data.entries | Select-Object -First 1
Check 'recent 200' ($null -ne $rec.data.entries) ("count=$($rec.data.entries.Count)")
if ($recFirst) { Write-Output ("    first: {0}" -f ($recFirst | ConvertTo-Json)) }

Write-Output '== 8. batch-download：正常 vs 路径穿越 =='
$testFile2 = 'D:\项目\cloud网盘系统\apps\server\storage\test%file.txt'
$sbg = [System.Text.StringBuilder]::new()
for ($i = 0; $i -lt 400; $i++) { $sbg.Append([guid]::NewGuid().ToString('N')) | Out-Null }

[System.IO.File]::WriteAllText($testFile2, $sbg.ToString(), [System.Text.Encoding]::ASCII)
function Send-Batch([string]$json) {
  $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:8080/api/v1/files/batch-download')
  $req.Method = 'POST'
  $req.ContentType = 'application/json'
  $req.Headers.Add('Authorization', "Bearer $token")
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $req.ContentLength = $bytes.Length
  $rs = $req.GetRequestStream(); $rs.Write($bytes, 0, $bytes.Length); $rs.Close()
  try { $wresp = $req.GetResponse() } catch [System.Net.WebException] { $wresp = $wresp = $_.Exception.Response }
  $stream = $wresp.GetResponseStream()
  $ms = [System.IO.MemoryStream]::new(); $stream.CopyTo($ms)
  [PSCustomObject]@{ code = [int]$wresp.StatusCode; len = $ms.Length }
}
try {
  $zip1 = Send-Batch '{"storageId":1,"paths":["/test%file.txt"]}'
  Check '正常批量下载有内容（zip）' (($zip1.code -eq 200) -and ($zip1.len -gt 200)) ("code=$($zip1.code) len=$($zip1.len)")
  $zip2 = Send-Batch '{"storageId":1,"paths":["../../../server/src/config.ts","../../..\\..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts"]}'
  Check '穿越路径被拦截（zip 为空）' (($zip2.code -eq 200) -and ($zip2.len -lt 100)) ("code=$($zip2.code) len=$($zip2.len)")
} finally {
  Remove-Item $testFile2 -ErrorAction SilentlyContinue
}

Write-Output '== 9. SPA：/quick-access 路由 + 新构建产物 =='
try {
  $spa = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/quick-access'
  Check 'GET /quick-access 200' ($true) ''
} catch { Check 'GET /quick-access 200' $false $_.Exception.Message }
$idx = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/'
$mainJsName = [regex]::Match($idx, '(assets/index-[A-Za-z0-9_-]+\.js)').Groups[1].Value
Write-Output ("  index.html 主 bundle: {0}" -f $mainJsName)
Check 'bundle 为新版 index-Xnu-ECdU' ($mainJsName -eq 'assets/index-Xnu-ECdU.js') ("actual=$mainJsName")
$mainJs = Invoke-RestMethod -Uri "http://127.0.0.1:8080/$mainJsName"
Check 'bundle 含 quick-access 路由' ($mainJs -match 'quick-access') ''
Check 'bundle 含 stardust/dawn/flow 主题' (($mainJs -match 'stardust') -and ($mainJs -match 'dawn') -and ($mainJs -match 'flow')) ''

Write-Output '== 10. IDOR 交叉验证：transfers 仅返回本人行 =='
$dbRows = & node 'D:\项目\cloud网盘系统\idor-check.js' | ConvertFrom-Json
$apiIds = @($gt.data.transfers | ForEach-Object { [int]$_.id })
$dbDevIds = [System.Collections.ArrayList]::new()
foreach ($r in $dbRows) { if ($r.user_id -eq 11) { $null = $dbDevIds.Add([int]$r.id) } }
$setEq = ($apiIds.Count -eq $dbDevIds.Count) -and -not (Compare-Object $apiIds $dbDevIds)
Check 'IDOR：API transfers 与 DB 中 devtest(user_id=11) 行一致' $setEq ("api={0} dbDev={1} dbAll={2}" -f $apiIds.Count, $dbDevIds.Count, @($dbRows).Count)

Write-Output ''
Write-Output ("RESULT: pass={0} fail={1}" -f $script:pass, $script:fail)
