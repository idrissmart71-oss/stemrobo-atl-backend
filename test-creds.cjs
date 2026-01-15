const fs = require('fs');
require('dotenv').config();

console.log('🔍 Testing credential formats...\n');

// Test 1: Check what env vars are set
console.log('Environment variables:');
console.log('- GOOGLE_APPLICATION_CREDENTIALS_JSON:', 
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? 'SET' : 'NOT SET');
console.log('- GOOGLE_APPLICATION_CREDENTIALS_BASE64:', 
  process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ? 'SET' : 'NOT SET');

// Test 2: Try parsing JSON
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  try {
    const creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    console.log('\n✅ JSON credentials parsed successfully');
    console.log('Fields:', Object.keys(creds));
    console.log('Has client_email?', !!creds.client_email);
    console.log('Has private_key?', !!creds.private_key);
    console.log('Has project_id?', !!creds.project_id);
    
    if (creds.client_email) {
      console.log('Email:', creds.client_email);
      console.log('Project:', creds.project_id);
    }
  } catch (err) {
    console.log('\n❌ JSON parsing failed:', err.message);
  }
}

// Test 3: Try parsing base64
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64) {
  try {
    const decoded = Buffer.from(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64, 
      'base64'
    ).toString('utf8');
    const creds = JSON.parse(decoded);
    console.log('\n✅ Base64 credentials decoded and parsed successfully');
    console.log('Fields:', Object.keys(creds));
    console.log('Has client_email?', !!creds.client_email);
    console.log('Has private_key?', !!creds.private_key);
    console.log('Has project_id?', !!creds.project_id);
    
    if (creds.client_email) {
      console.log('Email:', creds.client_email);
      console.log('Project:', creds.project_id);
    }
  } catch (err) {
    console.log('\n❌ Base64 decoding/parsing failed:', err.message);
  }
}

console.log('\n📝 Recommendations:');
console.log('- If both failed, regenerate credentials from Google Cloud Console');
console.log('- Use base64 encoding (more reliable than JSON escaping)');
console.log('- Verify the JSON has: type, project_id, private_key, client_email');