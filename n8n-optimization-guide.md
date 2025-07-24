# n8n Workflow Optimization Guide for Deep Marketing

## Current Issues
1. The report content appears to be truncated mid-sentence at "Tone of Voice: Casual, motivaz"
2. Formatting is lost and everything appears as one block of text

## Optimization Recommendations

### 1. Check Data Size Limits
The truncation might be happening due to:
- **n8n Node Output Limit**: Check if any nodes have output size limits
- **HTTP Request Body Size**: If using webhooks, ensure the body size limit is sufficient
- **Database Column Size**: Verify the `results` column in `deep_marketing_searches` table can store large JSON

### 2. Optimize the Workflow Structure

```javascript
// Instead of passing full content through multiple nodes, use references
const workflowOptimizations = {
  // Store large data in n8n's static data or use Set node
  storeInStaticData: {
    node: "Set",
    options: {
      keepOnlySet: true,
      values: {
        searchId: "={{$json.search_id}}",
        resultsRef: "={{$node['Store Results'].json}}"
      }
    }
  },
  
  // Use pagination for large results
  paginateResults: {
    batchSize: 1000,
    processInChunks: true
  }
};
```

### 3. Improve Data Processing

```javascript
// Function node to properly format the Deep Marketing report
const formatDeepMarketingReport = (rawData) => {
  // Ensure all sections are complete
  const sections = {
    marketOverview: {
      title: "📊 PANORAMICA DEL SETTORE",
      content: rawData.marketOverview || ""
    },
    competitors: {
      title: "🏢 PLAYER IDENTIFICATI", 
      content: rawData.competitors || ""
    },
    messagingAnalysis: {
      title: "💬 ANALISI MESSAGING",
      content: rawData.messagingAnalysis || ""
    },
    creativeStrategy: {
      title: "🎨 STRATEGIA CREATIVA",
      content: rawData.creativeStrategy || ""
    },
    strategicInsights: {
      title: "💡 INSIGHTS STRATEGICI",
      content: rawData.strategicInsights || ""
    },
    recommendations: {
      title: "🎯 RACCOMANDAZIONI",
      content: rawData.recommendations || ""
    },
    detailedAds: {
      title: "📱 ANNUNCI DETTAGLIATI",
      content: rawData.detailedAds || ""
    }
  };
  
  // Build full report with proper formatting
  const fullReport = Object.values(sections)
    .map(section => `## ${section.title}\n\n${section.content}`)
    .join("\n\n");
  
  return {
    sections,
    fullReport,
    summary: {
      timestamp: new Date().toISOString(),
      totalAdsAnalyzed: rawData.totalAds || 0,
      queries: rawData.queries || []
    },
    keyInsights: {
      brandUfficiali: extractBrands(rawData.competitors),
      retailer: extractRetailers(rawData.competitors),
      pmi: extractPMI(rawData.competitors),
      segnalazioni: extractAlerts(rawData.strategicInsights)
    }
  };
};
```

### 4. Webhook Optimization

```javascript
// Split large payloads into chunks
const sendResultsInChunks = async (searchId, results) => {
  const CHUNK_SIZE = 50000; // 50KB chunks
  const fullData = JSON.stringify(results);
  
  if (fullData.length < CHUNK_SIZE) {
    // Send as single payload
    return await sendWebhook({
      search_id: searchId,
      results: results,
      status: 'completed'
    });
  }
  
  // Send in chunks
  const chunks = [];
  for (let i = 0; i < fullData.length; i += CHUNK_SIZE) {
    chunks.push(fullData.slice(i, i + CHUNK_SIZE));
  }
  
  // Send metadata first
  await sendWebhook({
    search_id: searchId,
    status: 'processing',
    chunks_total: chunks.length
  });
  
  // Send each chunk
  for (let i = 0; i < chunks.length; i++) {
    await sendWebhook({
      search_id: searchId,
      chunk_index: i,
      chunk_data: chunks[i],
      status: i === chunks.length - 1 ? 'completed' : 'processing'
    });
  }
};
```

### 5. Error Handling and Validation

```javascript
// Add validation to ensure data completeness
const validateDeepMarketingResults = (data) => {
  const requiredFields = [
    'sections.marketOverview.content',
    'sections.competitors.content',
    'sections.messagingAnalysis.content',
    'fullReport'
  ];
  
  const errors = [];
  requiredFields.forEach(field => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], data);
    if (!value || value.length < 100) {
      errors.push(`Field ${field} is missing or too short`);
    }
  });
  
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(', ')}`);
  }
  
  // Check for truncation indicators
  const truncationIndicators = ['...', '..', 'Tone of Voice: Casual, motivaz'];
  const fullText = JSON.stringify(data);
  
  truncationIndicators.forEach(indicator => {
    if (fullText.endsWith(indicator)) {
      errors.push(`Data appears to be truncated at: ${indicator}`);
    }
  });
  
  return errors.length === 0;
};
```

### 6. Database Schema Optimization

```sql
-- Check and update column size if needed
ALTER TABLE deep_marketing_searches 
ALTER COLUMN results TYPE JSONB USING results::JSONB;

-- Add index for faster queries
CREATE INDEX idx_deep_marketing_searches_user_created 
ON deep_marketing_searches(user_id, created_at DESC);
```

### 7. n8n Workflow Configuration

1. **HTTP Request Node**: Increase timeout to 300 seconds
2. **Set Node**: Use "Keep Only Set" to reduce memory usage
3. **Function Node**: Add try-catch blocks and logging
4. **Webhook Node**: Set "Response Mode" to "When Last Node Finishes"

### 8. Memory Optimization

```javascript
// Clear large variables after use
const processLargeData = (data) => {
  let processedData = transformData(data);
  
  // Clear original data
  data = null;
  
  // Process in smaller chunks
  const results = [];
  while (processedData.length > 0) {
    const chunk = processedData.splice(0, 100);
    results.push(processChunk(chunk));
  }
  
  return results;
};
```

## Implementation Steps

1. First, verify the data is complete in n8n before sending
2. Add logging at each step to identify where truncation occurs
3. Implement chunked data transfer if needed
4. Update the frontend to handle chunked data reassembly
5. Add data validation before saving to database

## Quick Fix for Current Issue

In your n8n workflow, add this Function node before sending results:

```javascript
// Ensure complete data transfer
const results = $input.item.json;

// Log data size for debugging
console.log('Results size:', JSON.stringify(results).length);

// Validate fullReport exists and is complete
if (!results.fullReport || results.fullReport.length < 500) {
  throw new Error('Report appears incomplete or truncated');
}

// Check for truncation at the end
const lastChars = results.fullReport.slice(-50);
if (lastChars.includes('...') || lastChars.includes('motivaz')) {
  throw new Error('Report appears truncated at end');
}

return {
  json: {
    search_id: $input.item.json.search_id,
    results: results,
    status: 'completed',
    data_size: JSON.stringify(results).length
  }
};
```