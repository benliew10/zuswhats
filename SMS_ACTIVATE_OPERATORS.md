# SMS Activate Operator Configuration

## How to Filter by Operator

The bot can request phone numbers from a specific mobile operator by setting the `SMS_ACTIVATE_OPERATOR` environment variable.

### Configuration in `.env`

```env
# Malaysia (Country code 6)
SMS_ACTIVATE_COUNTRY=6
SMS_ACTIVATE_SERVICE=wa
SMS_ACTIVATE_OPERATOR=hotlink
```

---

## Malaysia Operators

For Malaysia (`SMS_ACTIVATE_COUNTRY=6`), you can use these operator values:

| Operator Name | Operator Code | Notes |
|---------------|---------------|-------|
| **Hotlink** | `hotlink` | Maxis prepaid brand |
| **Maxis** | `maxis` | Maxis postpaid |
| **Celcom** | `celcom` | Celcom Axiata |
| **Digi** | `digi` | Digi Telecommunications |
| **U Mobile** | `umobile` | U Mobile |
| **Any operator** | *(leave empty)* | No filter, accepts any operator |

---

## Example Configurations

### ✅ Hotlink Only

```env
SMS_ACTIVATE_COUNTRY=6
SMS_ACTIVATE_SERVICE=wa
SMS_ACTIVATE_OPERATOR=hotlink
```

This will **ONLY** request Hotlink numbers from SMS Activate.

### Maxis Only

```env
SMS_ACTIVATE_COUNTRY=6
SMS_ACTIVATE_SERVICE=wa
SMS_ACTIVATE_OPERATOR=maxis
```

### Any Malaysian Operator

```env
SMS_ACTIVATE_COUNTRY=6
SMS_ACTIVATE_SERVICE=wa
SMS_ACTIVATE_OPERATOR=
```

Or simply remove the `SMS_ACTIVATE_OPERATOR` line.

---

## How It Works

1. When a customer completes payment verification, the bot calls SMS Activate API
2. The API request includes the `operator` parameter (e.g., `operator=hotlink`)
3. SMS Activate returns a phone number **only from the Hotlink network**
4. If no Hotlink numbers are available, you'll get an error like `NO_NUMBERS`

---

## Important Notes

### ⚠️ Availability
- **Operator-filtered numbers may be less available** than "any operator" numbers
- If you get `NO_NUMBERS` errors, either:
  - Wait a few minutes and try again
  - Remove the operator filter temporarily
  - Check your SMS Activate balance

### 💰 Pricing
- Operator-filtered numbers may have **different pricing**
- Check https://sms-activate.org/en/prices for current rates

### 🔍 Country Codes Reference
Common country codes (if you need to support other countries):

| Country | Code |
|---------|------|
| Russia | 0 |
| Malaysia | 6 |
| Indonesia | 6 |
| Philippines | 4 |
| Thailand | 52 |
| Singapore | 64 |
| Vietnam | 10 |

For a full list, visit: https://sms-activate.org/en/api2

---

## Testing

To verify your operator configuration is working, check the bot logs when requesting a number:

```
📱 Requesting number from SMS Activate - Country: 7, Service: aik, Operator: hotlink
📱 Requesting number with operator filter: hotlink
✅ Number obtained: +60123456789 (Activation ID: 12345678)
```

The log should show:
- `Operator: hotlink` (or your chosen operator)
- A valid phone number from that operator

---

## Troubleshooting

### Error: `NO_NUMBERS`
**Cause:** No numbers available from the specified operator.

**Solutions:**
1. Wait a few minutes - numbers become available frequently
2. Remove the operator filter (set `SMS_ACTIVATE_OPERATOR=`)
3. Check if Hotlink numbers are available for WhatsApp service on https://sms-activate.org

### Error: `BAD_ACTION` or `BAD_KEY`
**Cause:** Invalid operator name or API key.

**Solutions:**
1. Double-check the operator name (must be lowercase: `hotlink`, not `Hotlink`)
2. Verify your API key is correct

### Numbers from wrong operator
**Cause:** Operator filter not being applied.

**Solutions:**
1. Make sure `.env` file contains `SMS_ACTIVATE_OPERATOR=hotlink`
2. Restart the bot after changing `.env`
3. Check the logs to confirm operator filter is being sent

---

## Need Help?

- **SMS Activate Documentation:** https://sms-activate.org/en/api2
- **Check Available Numbers:** https://sms-activate.org/en/freePrice
- **Support:** Contact SMS Activate support for operator-specific issues

