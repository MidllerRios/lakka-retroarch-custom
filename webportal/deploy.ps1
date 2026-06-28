$LHost = "192.168.15.252"
$User = "root"
$Pass = "root"
$RemoteDir = "/storage/webportal"

Write-Host "=== Deploy Web Portal Lakka ===" -ForegroundColor Cyan

# 1. Criar diretorios no Lakka
Write-Host "[1/4] Criando diretorios..." -ForegroundColor Yellow
plink -ssh -batch -l $User -pw $Pass $LHost "mkdir -p $RemoteDir/frontend/css $RemoteDir/frontend/js"

# 2. Copiar server.py
Write-Host "[2/4] Enviando server.py..." -ForegroundColor Yellow
pscp -pw $Pass "webportal\server.py" "${User}@${LHost}:${RemoteDir}/server.py"

# 3. Copiar frontend
Write-Host "[3/4] Enviando frontend..." -ForegroundColor Yellow
pscp -pw $Pass "webportal\index.html" "${User}@${LHost}:${RemoteDir}/frontend/index.html"
pscp -pw $Pass "webportal\css\style.css" "${User}@${LHost}:${RemoteDir}/frontend/css/style.css"
pscp -pw $Pass "webportal\js\app.js" "${User}@${LHost}:${RemoteDir}/frontend/js/app.js"

# 4. Reiniciar servico
Write-Host "[4/4] Reiniciando servico..." -ForegroundColor Yellow
plink -ssh -batch -l $User -pw $Pass $LHost "systemctl restart webportal.service; sleep 1; systemctl status webportal.service --no-pager | head -10"

Write-Host "=== Deploy concluido! http://${LHost}:8081 ===" -ForegroundColor Green
