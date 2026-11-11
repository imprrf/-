# Deploy script for user duplicate identity fix
# Usage: Run this script in PowerShell

$cli = 'D:\usually\微信web开发者工具\cli.bat'
$project = 'C:\Users\星耀14\Documents\wx_program\miniprogram'
$envId = 'cloud1-d4g22few1dfa58dd6'

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "User Duplicate Identity Fix - Deploy" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Deploying login..." -ForegroundColor Yellow
& $cli cloud functions inc-deploy -e $envId -n login -f . --project $project

Write-Host ""
Write-Host "[2/4] Deploying updateUserInfo..." -ForegroundColor Yellow
& $cli cloud functions inc-deploy -e $envId -n updateUserInfo -f . --project $project

Write-Host ""
Write-Host "[3/4] Deploying checkin..." -ForegroundColor Yellow
& $cli cloud functions inc-deploy -e $envId -n checkin -f . --project $project

Write-Host ""
Write-Host "[4/4] Deploying adminOps..." -ForegroundColor Yellow
& $cli cloud functions inc-deploy -e $envId -n adminOps -f . --project $project

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "All cloud functions deployed!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "1. Login to WeChat Cloud Console" -ForegroundColor White
Write-Host "2. Go to 'users' collection" -ForegroundColor White
Write-Host "3. Find duplicate _openid records" -ForegroundColor White
Write-Host "4. Keep the record with earlier createTime" -ForegroundColor White
Write-Host "5. Delete other duplicate records" -ForegroundColor White
