# Test script for Resume Builder API

Write-Host "Testing Resume Builder API..." -ForegroundColor Green
Write-Host ""

# Test 1: Health Check
Write-Host "1. Testing Health Endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/health" -Method GET
    Write-Host "   ✓ Health check passed" -ForegroundColor Green
    Write-Host "   Response: $($response | ConvertTo-Json)" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 2: API Test Endpoint
Write-Host "2. Testing API Test Endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/test" -Method GET
    Write-Host "   ✓ API test passed" -ForegroundColor Green
    Write-Host "   Success: $($response.success)" -ForegroundColor Gray
    Write-Host "   Message: $($response.message)" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ API test failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 3: Register Endpoint (should work)
Write-Host "3. Testing Register Endpoint..." -ForegroundColor Yellow
try {
    $body = @{
        name = "Test User"
        email = "test$(Get-Random)@example.com"
        password = "password123"
        password_confirmation = "password123"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/register" -Method POST -Body $body -ContentType "application/json"
    Write-Host "   ✓ Registration test passed" -ForegroundColor Green
    Write-Host "   User ID: $($response.data.user.id)" -ForegroundColor Gray
    Write-Host "   Token received: $($response.data.token -ne $null)" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ Registration test failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "   Error details: $responseBody" -ForegroundColor Red
    }
}
Write-Host ""

Write-Host "Testing complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Update extension config to use http://localhost:3000" -ForegroundColor White
Write-Host "2. Test the extension with the new backend" -ForegroundColor White
Write-Host "3. Test resume upload and tailoring" -ForegroundColor White
