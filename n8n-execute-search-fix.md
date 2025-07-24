# Fix for Execute Search Webhook in n8n

## Problem
The execute_search webhook returns 500 error because it's configured differently than the working create_plan webhook.

## Solution
Modify the execute_search workflow to match the create_plan pattern:

### 1. Webhook Node Configuration
- **Webhook URL**: Keep the existing URL
- **HTTP Method**: POST
- **Response Mode**: `Using 'Respond to Webhook' Node` (NOT "Immediately")
- **Response Data**: None needed here

### 2. Add "Respond to Webhook" Node (Right After Webhook)
- **Node Type**: Respond to Webhook
- **Response Code**: 200
- **Response Body**: 
```json
{
  "success": true,
  "message": "Search execution started",
  "search_id": "{{ $json.search_id }}"
}
```

### 3. Remove HTTP Request Node
- Delete the HTTP Request node that tries to send results back
- The MCP Agent node will handle sending results to the callback URL

### 4. Workflow Structure Should Be:
1. Webhook (trigger)
2. Respond to Webhook (immediate response)
3. MCP Agent (process search)
4. (Any other processing nodes)
5. End (no HTTP Request needed)

### 5. Important Settings
- Increase execution timeout in workflow settings (like we did for create_plan)
- Make sure the MCP Agent is configured to send results to the callback_url provided in the webhook payload

## Test Payload
```json
{
  "action": "execute_search",
  "search_id": "test-123",
  "plan": {
    "keywords": ["nike", "adidas"],
    "pages": ["nike", "adidas"],
    "date_range": {"from": "2024-01-01", "to": "2024-07-24"}
  },
  "user_id": "test-user",
  "mcp_endpoint": "http://localhost:3000/mcp-api/sse",
  "callback_url": "http://localhost:3000/api/deep-marketing/receive-results",
  "timestamp": "2025-07-24T08:00:00Z"
}
```

## Why This Works
- The webhook responds immediately with success (avoiding timeout)
- The actual processing happens asynchronously
- Results are sent to callback_url when ready
- This matches the pattern that works in create_plan