const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error("Error: .env file not found! Please copy .env.example or create a .env file.");
  process.exit(1);
}

const content = fs.readFileSync(envPath, 'utf-8');
const lines = content.split(/\r?\n/);
const envVars = {};

for (let line of lines) {
  line = line.trim();
  if (!line || line.startsWith('#')) continue;
  const eqIdx = line.indexOf('=');
  if (eqIdx === -1) continue;
  const key = line.substring(0, eqIdx).trim();
  const val = line.substring(eqIdx + 1).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    console.error(`Ignoring invalid environment variable name: ${key}`);
    continue;
  }
  envVars[key] = val;
}

// 1. Write to .dev.vars for local development
console.log("Writing secrets to .dev.vars for local development...");
let devVarsContent = "";
for (const [key, val] of Object.entries(envVars)) {
  devVarsContent += `${key}=${val}\n`;
}
const devVarsPath = path.join(__dirname, '.dev.vars');
fs.writeFileSync(devVarsPath, devVarsContent, { encoding: 'utf-8', mode: 0o600 });
try { fs.chmodSync(devVarsPath, 0o600); } catch (_) {}
console.log(".dev.vars written successfully.");

// 2. Upload to Cloudflare if --prod flag is present
const args = process.argv.slice(2);
if (args.includes('--prod')) {
  console.log("\nUploading secrets to Cloudflare production...");
  for (const [key, val] of Object.entries(envVars)) {
    try {
      console.log(`Uploading secret: ${key}...`);
      execFileSync('npx', ['wrangler', 'secret', 'put', key], {
        input: val,
        stdio: ['pipe', 'inherit', 'inherit']
      });
    } catch (err) {
      console.error(`Failed to upload ${key}. Make sure you are logged into wrangler and have created the database/worker.`);
    }
  }
  console.log("Production secrets deployment complete.");
} else {
  console.log("\nLocal environment set up.");
  console.log("To deploy these secrets to Cloudflare Production, run: npm run secrets:deploy -- --prod");
}
