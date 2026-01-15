const fs = require('fs');
const path = require('path');

console.log('🔍 Looking for Google credentials files...\n');

// Look for JSON files in current directory
const files = fs.readdirSync('.').filter(f => 
  f.endsWith('.json') && 
  f !== 'package.json' && 
  f !== 'package-lock.json' && 
  f !== 'tsconfig.json'
);

if (files.length === 0) {
  console.log('❌ No credential files found in backend folder.');
  console.log('\n📝 Please do one of the following:');
  console.log('   1. Download your credentials from Google Cloud Console');
  console.log('   2. Move it to the backend folder');
  console.log('   3. Run this script again');
  console.log('\nOr specify the full path:');
  console.log('   node encode-creds.cjs "C:/path/to/your-credentials.json"');
  process.exit(1);
}

// If path provided as argument, use that
let targetFile = process.argv[2];

// Otherwise, show available files
if (!targetFile) {
  console.log('Found these credential files:');
  files.forEach((f, i) => {
    console.log(`   ${i + 1}. ${f}`);
  });
  
  if (files.length === 1) {
    targetFile = files[0];
    console.log(`\n✅ Using: ${targetFile}`);
  } else {
    console.log('\n💡 Run this script with the filename:');
    console.log(`   node encode-creds.cjs "${files[0]}"`);
    process.exit(1);
  }
}

try {
  // Read and validate JSON
  const data = fs.readFileSync(targetFile, 'utf8');
  const parsed = JSON.parse(data);
  
  console.log('\n📋 Credential Details:');
  console.log('   Type:', parsed.type);
  console.log('   Project:', parsed.project_id);
  console.log('   Email:', parsed.client_email);
  
  // Generate base64
  const base64 = Buffer.from(data).toString('base64');
  
  console.log('\n========================================');
  console.log('BASE64 ENCODED (Copy this entire string):');
  console.log('========================================');
  console.log(base64);
  console.log('========================================');
  
  // Save to file
  fs.writeFileSync('credentials-base64.txt', base64);
  console.log('\n✅ Saved to: credentials-base64.txt');
  
  // Also show properly escaped JSON
  const escapedJson = JSON.stringify(parsed);
  fs.writeFileSync('credentials-escaped.txt', escapedJson);
  console.log('✅ Saved escaped JSON to: credentials-escaped.txt');
  
  console.log('\n📝 Next Steps:');
  console.log('   1. Open credentials-base64.txt and copy the entire contents');
  console.log('   2. In Render, add environment variable:');
  console.log('      Name: GOOGLE_APPLICATION_CREDENTIALS_BASE64');
  console.log('      Value: [paste the base64 string]');
  console.log('   3. Redeploy your backend');
  console.log('\n   OR use the escaped JSON:');
  console.log('      Name: GOOGLE_APPLICATION_CREDENTIALS_JSON');
  console.log('      Value: [paste from credentials-escaped.txt]');
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  if (error.code === 'ENOENT') {
    console.log(`\n💡 File not found: ${targetFile}`);
    console.log('   Make sure the file exists in the backend folder.');
  } else if (error instanceof SyntaxError) {
    console.log('\n💡 Invalid JSON file. Make sure it\'s a valid credentials file.');
  }
  process.exit(1);
}