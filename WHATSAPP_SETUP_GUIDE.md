# WhatsApp Integration: Complete Setup Guide

## Overview
Your Xeno CRM supports **two modes** of WhatsApp messaging:
- **Option 1**: Real Meta WhatsApp API (after phone whitelisting)
- **Option 2**: Simulation Mode (immediate testing)

---

## ✅ OPTION 2: Start Testing NOW with Simulation Mode

### What is Simulation Mode?
Messages are "sent" through your local simulator without hitting Meta's API. Perfect for testing workflows immediately.

### How to Use Simulation Mode

#### Method A: Via CRM Dashboard
1. Go to **Campaigns** tab
2. Create/edit a campaign with message "gtgkfg" or any text
3. Click **Send Campaign**
4. In the background, the system will log this as a "sent" message
5. Go to **Channel Stub Console** (http://localhost:3001) to see simulated messages
6. Click on a message and use the **Manual Callback Controls** to simulate delivery events:
   - "Force Deliver" → marks as delivered
   - "Force Open" → marks as opened
   - "Force Click" → records click event
   - "Simulate Attributed Purchase" → records purchase

#### Method B: Direct API Call (Simulation)
```bash
# Using PowerShell
$body = @{
  campaign = @{ 
    id = "sim_campaign"; 
    name = "Test Campaign"; 
    channel = "whatsapp" 
  }
  communications = @(
    @{
      id = "comm_1"
      customer = @{ 
        id = "cus_29e6c7a3"
        name = "Aanya Sharma"
        phone = "+919000010001"
      }
      message = "Hello! Testing WhatsApp."
    }
  )
  callbackUrl = "http://localhost:3000/api/receipts"
  forceSimulation = $true  # ← KEY: Force simulation mode
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3001/send" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body $body `
  -UseBasicParsing
```

**Result**: Message is logged as "sent" in the simulator. No Meta API call is made.

---

## 🚀 OPTION 1: Real Meta WhatsApp API (Production)

### Prerequisites
- Meta Business Account with WhatsApp Business App configured
- Phone numbers **must** be whitelisted first

### Step 1: Whitelist Phone Numbers on Meta

1. **Login to Meta Business Manager**
   - Go to https://business.facebook.com/

2. **Navigate to WhatsApp Settings**
   - Left menu → WhatsApp → Account Settings
   - Or: Apps & Assets → WhatsApp → Phone Numbers

3. **Add Your Recipient Phone Numbers**
   - Click "Add Phone Number" or "Manage"
   - Add these numbers (already in your CRM):
     - +919000010001 (Aanya Sharma)
     - +919000010002 (Arjun Mehta)
     - +919000010005 (Isha Nair)
     - +919000010007 (Diya Kapoor)
     - +919000010009 (Sara Khan)
     - +917896366654 (Abir Bora)
     - +919876366654 (Akash)

4. **Wait for Approval**
   - Usually instant, but can take up to 24 hours
   - Once approved, the phone numbers appear as "Approved"

### Step 2: Verify Configuration
1. In your Xeno CRM, go to **Settings** → **WhatsApp Configuration**
2. Verify these are set:
   ```json
   {
     "provider": "meta",
     "metaPhoneId": "1112508165287114",
     "metaAccessToken": "EAA...",
     "metaApiVersion": "v21.0",
     "metaUseTemplateForCampaigns": false
   }
   ```

### Step 3: Send Real Messages
```bash
# Same as simulation, but WITHOUT forceSimulation flag

$body = @{
  campaign = @{ 
    id = "real_campaign"; 
    name = "Real Campaign"; 
    channel = "whatsapp" 
  }
  communications = @(
    @{
      id = "comm_real_1"
      customer = @{ 
        id = "cus_29e6c7a3"
        name = "Aanya Sharma"
        phone = "+919000010001"  # Must be whitelisted!
      }
      message = "Hello from WhatsApp!"
    }
  )
  callbackUrl = "http://localhost:3000/api/receipts"
  # ← NO forceSimulation flag = Real Meta API call
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3001/send" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body $body `
  -UseBasicParsing
```

**Result**: Real message sent via Meta WhatsApp API. Recipient receives it on WhatsApp.

---

## 🔄 Using BOTH Options Together (Recommended Workflow)

### Phase 1: Development & Testing (Use Simulation)
```
1. Create campaigns in Xeno CRM
2. Test messages with simulation mode
3. Verify event callbacks work (delivered, opened, clicked, etc.)
4. Test metrics tracking and customer attribution
```

### Phase 2: Staging & Pre-Production (Use Real)
```
1. Whitelist test phone numbers in Meta Business Account
2. Send real messages to test recipients
3. Verify delivery, billing, and webhook callbacks
4. Monitor logs and error handling
```

### Phase 3: Production (Use Real)
```
1. Whitelist customer phone numbers in Meta
2. Send real campaigns to customers
3. Monitor delivery rates and metrics
4. Handle opt-outs and unsubscribes
```

---

## 📊 Monitor Messages

### Via Channel Stub Console (http://localhost:3001)
- **Live Simulation Log** shows all sent messages
- Click a message to see details and trigger manual callbacks
- Shows which messages succeeded vs. failed

### Via CRM Dashboard (http://localhost:3000)
- **Analytics & Logs** → See campaign metrics
- **Campaigns** → View delivery rate, clicks, purchases attributed

---

## 🛠️ Troubleshooting

### Error: "Recipient phone number not in allowed list"
- **Cause**: Phone number not whitelisted in Meta Business Account
- **Fix**: Add the number to Meta (Step 1 above), wait for approval
- **Test**: Use simulation mode while waiting

### Error: "Template not found"
- **Cause**: `metaUseTemplateForCampaigns` is `true` but template doesn't exist
- **Fix**: Set `metaUseTemplateForCampaigns: false` in WhatsApp config

### Message status stuck on "sent"
- **Cause**: Webhook callback from Meta not received yet
- **Fix**: Use Channel Stub to manually trigger callbacks while testing

---

## ✨ Summary

| Feature | Simulation Mode | Real Meta API |
|---------|-----------------|---------------|
| Setup Time | Instant ⚡ | ~5 min + 24h approval ⏳ |
| Phone Whitelisting | Not required | **Required** |
| Cost | Free | Per message ($) |
| Testing | Full | Full |
| Production Use | No | Yes ✅ |
| Best For | Dev/Test | Live Customers |

**Recommended**: Start with **Simulation Mode** → Switch to **Real Mode** once ready

