// Test script per verificare le sessioni
const axios = require('axios');

async function testSession() {
    const baseUrl = 'http://localhost:3000';
    
    try {
        // 1. Prima fai logout per pulire
        console.log('1. Cleaning session...');
        await axios.get(`${baseUrl}/logout`);
        
        // 2. Login con info@growthers.io
        console.log('2. Logging in as info@growthers.io...');
        const loginResponse = await axios.post(`${baseUrl}/login`, 
            'email=info@growthers.io&password=your-password&state=', 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400
            }
        );
        
        // Get session cookie
        const cookies = loginResponse.headers['set-cookie'];
        console.log('Cookies received:', cookies);
        
        // 3. Try to access admin panel
        console.log('3. Accessing admin panel...');
        const adminResponse = await axios.get(`${baseUrl}/admin/webhooks`, {
            headers: {
                'Cookie': cookies ? cookies.join('; ') : ''
            },
            maxRedirects: 0,
            validateStatus: (status) => true
        });
        
        console.log('Admin panel response:', adminResponse.status);
        if (adminResponse.status === 403) {
            console.log('Access denied message:', adminResponse.data);
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testSession();