# ============================================
# Meta WhatsApp Phone Number Whitelist Script
# ============================================
# This script automatically adds customer phone numbers to your Meta Business Account

# Configuration (from your Xeno setup)
$WABA_ID = "1529748218558501"              # WhatsApp Business Account ID
$PHONE_NUMBER_ID = "1112508165287114"      # Your Phone Number ID
$API_VERSION = "v21.0"

# Read access token from .env
$envFile = Join-Path $PSScriptRoot ".env"
$accessToken = $null

if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
    if ($envContent -match 'WHATSAPP_ACCESS_TOKEN=(.+)') {
        $accessToken = $matches[1].Trim()
    }
}

if (-not $accessToken) {
    Write-Host "❌ ERROR: Could not find WHATSAPP_ACCESS_TOKEN in .env file" -ForegroundColor Red
    exit 1
}

# Customer phone numbers to whitelist
$phoneNumbers = @(
    "+919000010001",  # Aanya Sharma
    "+919000010002",  # Arjun Mehta
    "+919000010003",  # Meera Iyer
    "+919000010004",  # Kabir Singh
    "+919000010005",  # Isha Nair
    "+919000010006",  # Rahul Verma
    "+919000010007",  # Diya Kapoor
    "+919000010008",  # Nikhil Rao
    "+919000010009",  # Sara Khan
    "+919000010010",  # Dev Joshi
    "+917896366654",  # Abir Bora
    "+919876366654"   # Akash
)

Write-Host "🚀 Starting WhatsApp Phone Number Whitelisting" -ForegroundColor Cyan
Write-Host "WABA ID: $WABA_ID" -ForegroundColor Gray
Write-Host "Phone Number ID: $PHONE_NUMBER_ID" -ForegroundColor Gray
Write-Host "API Version: $API_VERSION" -ForegroundColor Gray
Write-Host "Total Numbers to Add: $($phoneNumbers.Count)" -ForegroundColor Gray
Write-Host ""

# API endpoint for adding phone numbers to whitelist
$apiUrl = "https://graph.instagram.com/$API_VERSION/$PHONE_NUMBER_ID/phone_number_whitelisting/whitelist_samples"

$successCount = 0
$failureCount = 0
$failures = @()

foreach ($phone in $phoneNumbers) {
    Write-Host "Adding: $phone ... " -NoNewline -ForegroundColor Yellow
    
    try {
        # Prepare payload with phone number
        $payload = @{
            phone_numbers = @($phone)
        } | ConvertTo-Json
        
        # Call Meta API
        $response = Invoke-WebRequest `
            -Uri "$apiUrl`?access_token=$accessToken" `
            -Method POST `
            -Headers @{"Content-Type"="application/json"} `
            -Body $payload `
            -UseBasicParsing `
            -TimeoutSec 10 `
            -ErrorAction Stop
        
        if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 201) {
            Write-Host "✅ SUCCESS" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "⚠️  QUEUED" -ForegroundColor Yellow
            $successCount++
        }
    }
    catch {
        $errorMsg = $_.Exception.Message
        if ($_.Exception.Response) {
            try {
                $stream = $_.Exception.Response.Content.ReadAsStream()
                $reader = [System.IO.StreamReader]::new($stream)
                $errorContent = $reader.ReadToEnd()
                $errorMsg = ($errorContent | ConvertFrom-Json | ConvertTo-Json -Compress)
            } catch {}
        }
        
        Write-Host "❌ FAILED" -ForegroundColor Red
        $failureCount++
        $failures += @{
            phone = $phone
            error = $errorMsg
        }
    }
    
    Start-Sleep -Milliseconds 800  # Rate limiting
}

# Summary
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "📊 RESULTS" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "✅ Added/Approved: $successCount" -ForegroundColor Green
Write-Host "❌ Failed: $failureCount" -ForegroundColor Red
Write-Host ""

if ($failureCount -gt 0) {
    Write-Host "Failed Numbers:" -ForegroundColor Yellow
    foreach ($failure in $failures) {
        Write-Host "  • $($failure.phone): $($failure.error)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "📱 Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Check Meta Business Suite → WhatsApp Manager → Phone Numbers" -ForegroundColor Gray
Write-Host "  2. Wait for approval (usually instant, max 24 hours)" -ForegroundColor Gray
Write-Host "  3. Once approved, phone numbers status will show 'Approved'" -ForegroundColor Gray
Write-Host "  4. Update your .env: Remove forceSimulation flag or set to false" -ForegroundColor Gray
Write-Host "  5. Real messages will now send via Meta API! 🎉" -ForegroundColor Gray
