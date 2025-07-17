const axios = require('axios');

// Test direct Supabase API call
async function testSupabaseDirectly() {
  const SUPABASE_URL = 'https://bdqdhuvfmgmhlxfhxkvj.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkcWRodXZmbWdtaGx4Zmh4a3ZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTgxMTM0MSwiZXhwIjoyMDY3Mzg3MzQxfQ.AF406FaIJZzrP4S4gGwTLvBH-mOEo5C96iK-oI3MwK8';
  
  // Test data
  const testData = {
    user_id: 'test-direct-' + Date.now(),
    access_token: 'test-token-direct',
    service: 'competition',
    updated_at: new Date().toISOString()
  };
  
  try {
    console.log('Testing direct API call to Supabase...');
    console.log('URL:', `${SUPABASE_URL}/rest/v1/facebook_tokens`);
    console.log('Data:', testData);
    
    const response = await axios.post(
      `${SUPABASE_URL}/rest/v1/facebook_tokens`,
      testData,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      }
    );
    
    console.log('✅ Success! Response:', response.status, response.statusText);
    
    // Clean up
    await axios.delete(
      `${SUPABASE_URL}/rest/v1/facebook_tokens?user_id=eq.${testData.user_id}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    
    console.log('✅ Test data cleaned up');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.status, error.response?.data || error.message);
  }
}

// Run the test
testSupabaseDirectly();