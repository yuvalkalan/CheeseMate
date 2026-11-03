/**
 * CheeseMate Database Local Backup Script
 *
 * Backs up:
 *  1. All Firestore root collections ('users', 'permissionLevels', 'courseFeedback', 'courseFeedbackReports', etc.)
 *  2. All nested subcollections (e.g., users/{userId}/semesters, users/{userId}/notifications)
 *  3. Cloudflare KV Web Push Subscriptions
 *
 * Saves backups to:
 *  - backups/backup_YYYY-MM-DD_HH-mm-ss/
 *  - backups/latest/
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const dns = require('dns').promises;

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
  }
}
loadEnvFile();

const PROJECT_ID = 'cheesemate-yk';
const CLOUDFLARE_ACCOUNT_ID = 'ee7a91c25accf74d7563fb9eb4a54f3e';
const CLOUDFLARE_KV_NAMESPACE_ID = '4b0c98a463bd4b90ac435d4b7b59f18d';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

const FIREBASE_CONFIG_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.config', 'configstore', 'firebase-tools.json'
);

// Cache resolved IPv4 addresses to avoid DNS/IPv6 issues on campus/local networks
const ipCache = {};

async function resolveIPv4(hostname) {
  if (ipCache[hostname]) {
    return ipCache[hostname];
  }
  try {
    const addresses = await dns.resolve4(hostname);
    if (addresses && addresses.length > 0) {
      ipCache[hostname] = addresses[0];
      return addresses[0];
    }
  } catch (err) {
    // Fall back to hostname if resolution fails
  }
  return hostname;
}

async function requestHttps(hostname, path, options = {}) {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body;
  const timeoutMs = options.timeout || 30000;

  const targetIp = await resolveIPv4(hostname);

  return new Promise((resolve, reject) => {
    let postData = null;
    if (body !== undefined && body !== null) {
      postData = typeof body === 'string' ? body : JSON.stringify(body);
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    headers['Host'] = hostname;

    const reqOptions = {
      host: targetIp,
      port: 443,
      path: path,
      method: method,
      servername: hostname,
      headers: headers,
      timeout: timeoutMs
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request to ${hostname}${path} timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Get or refresh Google OAuth token from Firebase CLI configuration
 */
async function getGoogleAccessToken() {
  if (!fs.existsSync(FIREBASE_CONFIG_PATH)) {
    throw new Error(`Firebase tools configuration not found at: ${FIREBASE_CONFIG_PATH}`);
  }

  const rawConfig = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_PATH, 'utf8'));
  let accessToken = rawConfig.tokens && rawConfig.tokens.access_token;
  const refreshToken = rawConfig.tokens && rawConfig.tokens.refresh_token;

  if (!accessToken && !refreshToken) {
    throw new Error('No Firebase tokens found. Please run "firebase login" first.');
  }

  // Verify access token with a test call
  let isValid = false;
  if (accessToken) {
    try {
      const test = await requestHttps('firestore.googleapis.com', `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users?pageSize=1`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (test.statusCode === 200) {
        isValid = true;
      }
    } catch (e) {
      isValid = false;
    }
  }

  if (!isValid && refreshToken) {
    console.log('🔄 Access token expired. Refreshing token via Google OAuth...');
    const refreshBody = new URLSearchParams({
      client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
      client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString();

    const refreshRes = await requestHttps('oauth2.googleapis.com', '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody
    });

    if (refreshRes.statusCode === 200 && refreshRes.data && refreshRes.data.access_token) {
      accessToken = refreshRes.data.access_token;
      rawConfig.tokens.access_token = accessToken;
      try {
        fs.writeFileSync(FIREBASE_CONFIG_PATH, JSON.stringify(rawConfig, null, 2), 'utf8');
      } catch (e) {
        // Ignore file lock errors if any
      }
      console.log('✅ Access token refreshed successfully.');
    } else {
      throw new Error(`Failed to refresh Google OAuth token: ${JSON.stringify(refreshRes.data)}`);
    }
  }

  return accessToken;
}

/**
 * Decode Firestore REST field object into plain JavaScript primitive/object
 */
function decodeFirestoreValue(val) {
  if (val === null || val === undefined) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) {
    const num = Number(val.integerValue);
    return Number.isSafeInteger(num) ? num : val.integerValue;
  }
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('bytesValue' in val) return val.bytesValue;
  if ('referenceValue' in val) return val.referenceValue;
  if ('geoPointValue' in val) return val.geoPointValue;
  if ('arrayValue' in val) {
    const arr = (val.arrayValue && val.arrayValue.values) || [];
    return arr.map(decodeFirestoreValue);
  }
  if ('mapValue' in val) {
    const fields = (val.mapValue && val.mapValue.fields) || {};
    const res = {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = decodeFirestoreValue(v);
    }
    return res;
  }
  return val;
}

function decodeFirestoreDocument(doc) {
  const result = {
    _id: doc.name ? doc.name.split('/').pop() : '',
    _path: doc.name || '',
    _createTime: doc.createTime || null,
    _updateTime: doc.updateTime || null
  };
  const fields = doc.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    result[k] = decodeFirestoreValue(v);
  }
  return result;
}

/**
 * Firestore API client helpers
 */
class FirestoreBackupClient {
  constructor(token) {
    this.token = token;
  }

  async fetchCollectionIds(parentPath = '') {
    const subpath = parentPath ? `/${parentPath}` : '';
    const url = `/v1/projects/${PROJECT_ID}/databases/(default)/documents${subpath}:listCollectionIds`;
    const res = await requestHttps('firestore.googleapis.com', url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: {}
    });
    if (res.statusCode === 200 && res.data && Array.isArray(res.data.collectionIds)) {
      return res.data.collectionIds;
    }
    return [];
  }

  async fetchDocumentsInCollection(collectionPath) {
    const allDocs = [];
    let pageToken = '';

    do {
      const q = new URLSearchParams({ pageSize: '100' });
      if (pageToken) q.set('pageToken', pageToken);
      const url = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionPath}?${q.toString()}`;

      const res = await requestHttps('firestore.googleapis.com', url, {
        headers: { Authorization: `Bearer ${this.token}` }
      });

      if (res.statusCode === 200 && res.data) {
        if (Array.isArray(res.data.documents)) {
          allDocs.push(...res.data.documents);
        }
        pageToken = res.data.nextPageToken || '';
      } else if (res.statusCode === 404) {
        break;
      } else {
        console.warn(`⚠️ Warning fetching ${collectionPath}: status ${res.statusCode}`);
        break;
      }
    } while (pageToken);

    return allDocs;
  }
}

/**
 * Cloudflare KV backup helper
 */
async function fetchCloudflareKV() {
  if (!CLOUDFLARE_API_TOKEN) {
    console.log('ℹ️ Skipping Cloudflare KV (No API token found)');
    return null;
  }

  try {
    const listUrl = `/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/keys`;
    const listRes = await requestHttps('api.cloudflare.com', listUrl, {
      headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` }
    });

    if (listRes.statusCode !== 200 || !listRes.data || !listRes.data.success) {
      console.warn('⚠️ Cloudflare KV keys list failed:', listRes.data);
      return null;
    }

    const keys = (listRes.data.result || []).map(r => r.name);
    console.log(`📦 Found ${keys.length} Cloudflare KV push subscription key(s)...`);

    const result = {};
    for (const key of keys) {
      const valUrl = `/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
      const valRes = await requestHttps('api.cloudflare.com', valUrl, {
        headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` }
      });
      result[key] = valRes.data;
    }

    return result;
  } catch (err) {
    console.warn('⚠️ Cloudflare KV fetch error:', err.message);
    return null;
  }
}

function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }
  fs.readdirSync(from).forEach(element => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    if (fs.lstatSync(fromPath).isFile()) {
      fs.copyFileSync(fromPath, toPath);
    } else {
      copyFolderSync(fromPath, toPath);
    }
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function getDirectorySize(dirPath) {
  let total = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const files = fs.readdirSync(dirPath);
  for (const f of files) {
    const full = path.join(dirPath, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      total += getDirectorySize(full);
    } else {
      total += stat.size;
    }
  }
  return total;
}

async function main() {
  console.log('========================================================');
  console.log('   🧀 CheeseMate Complete Database Local Backup Tool     ');
  console.log('========================================================\n');

  const startTime = Date.now();
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDirName = `backup_${dateStr}`;
  const backupsRoot = path.join(process.cwd(), 'backups');
  const targetDir = path.join(backupsRoot, backupDirName);
  const collectionsDir = path.join(targetDir, 'collections');
  const latestDir = path.join(backupsRoot, 'latest');

  fs.mkdirSync(collectionsDir, { recursive: true });

  console.log(`🔐 Authenticating with Google Cloud / Firebase...`);
  const token = await getGoogleAccessToken();
  const client = new FirestoreBackupClient(token);

  console.log(`\n🔍 Discovering Firestore root collections...`);
  const discoveredRoots = await client.fetchCollectionIds();
  const knownRoots = ['permissionLevels', 'users', 'courseFeedback', 'courseFeedbackReports'];
  const allRoots = Array.from(new Set([...knownRoots, ...discoveredRoots]));

  console.log(`Found root collections: ${allRoots.join(', ')}\n`);

  const fullRawDatabase = {};
  const fullDecodedDatabase = {};
  let totalDocumentsCount = 0;

  for (const rootCol of allRoots) {
    console.log(`📂 Processing collection: "${rootCol}"...`);
    const rootColDir = path.join(collectionsDir, rootCol);
    fs.mkdirSync(rootColDir, { recursive: true });

    const rawDocs = await client.fetchDocumentsInCollection(rootCol);
    fullRawDatabase[rootCol] = {};
    fullDecodedDatabase[rootCol] = {};

    console.log(`   Found ${rawDocs.length} document(s) in "${rootCol}".`);

    for (const doc of rawDocs) {
      totalDocumentsCount++;
      const docId = doc.name.split('/').pop();
      const relativeDocPath = `${rootCol}/${docId}`;

      const decoded = decodeFirestoreDocument(doc);
      fullRawDatabase[rootCol][docId] = {
        _document: doc,
        _subcollections: {}
      };
      fullDecodedDatabase[rootCol][docId] = {
        ...decoded,
        _subcollections: {}
      };

      // Check for subcollections under this document
      const subColIds = await client.fetchCollectionIds(relativeDocPath);

      if (subColIds.length > 0) {
        const docSubDir = path.join(rootColDir, docId);
        fs.mkdirSync(docSubDir, { recursive: true });

        // Save parent profile file in subfolder
        fs.writeFileSync(
          path.join(docSubDir, '_doc.json'),
          JSON.stringify(decoded, null, 2),
          'utf8'
        );

        for (const subCol of subColIds) {
          const subColPath = `${relativeDocPath}/${subCol}`;
          const subDocs = await client.fetchDocumentsInCollection(subColPath);
          console.log(`      ↳ Subcollection "${subCol}" under ${docId}: ${subDocs.length} document(s)`);

          const subColDir = path.join(docSubDir, subCol);
          fs.mkdirSync(subColDir, { recursive: true });

          fullRawDatabase[rootCol][docId]._subcollections[subCol] = {};
          fullDecodedDatabase[rootCol][docId]._subcollections[subCol] = {};

          for (const sDoc of subDocs) {
            totalDocumentsCount++;
            const sDocId = sDoc.name.split('/').pop();
            const sDecoded = decodeFirestoreDocument(sDoc);

            fullRawDatabase[rootCol][docId]._subcollections[subCol][sDocId] = sDoc;
            fullDecodedDatabase[rootCol][docId]._subcollections[subCol][sDocId] = sDecoded;

            fs.writeFileSync(
              path.join(subColDir, `${sDocId}.json`),
              JSON.stringify(sDecoded, null, 2),
              'utf8'
            );
          }
        }
      } else {
        // Simple document without subcollections
        fs.writeFileSync(
          path.join(rootColDir, `${docId}.json`),
          JSON.stringify(decoded, null, 2),
          'utf8'
        );
      }
    }
  }

  // Backup Cloudflare KV subscriptions
  console.log(`\n☁️ Backing up Cloudflare KV Web Push Subscriptions...`);
  const kvData = await fetchCloudflareKV();
  if (kvData) {
    fs.writeFileSync(
      path.join(targetDir, 'cloudflare_kv_subscriptions.json'),
      JSON.stringify(kvData, null, 2),
      'utf8'
    );
    console.log(`✅ Cloudflare KV subscriptions saved (${Object.keys(kvData).length} users).`);
  }

  // Save complete aggregated files
  console.log(`\n💾 Writing full aggregated database dumps...`);
  fs.writeFileSync(
    path.join(targetDir, 'full_backup_decoded.json'),
    JSON.stringify(fullDecodedDatabase, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(targetDir, 'full_backup_raw.json'),
    JSON.stringify(fullRawDatabase, null, 2),
    'utf8'
  );

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const totalSizeBytes = getDirectorySize(targetDir);

  // Metadata
  const metadata = {
    projectName: 'CheeseMate',
    projectId: PROJECT_ID,
    backupTimestamp: new Date().toISOString(),
    durationSeconds: Number(durationSec),
    totalDocuments: totalDocumentsCount,
    totalSizeFormatted: formatBytes(totalSizeBytes),
    rootCollections: allRoots,
    hasCloudflareKV: Boolean(kvData)
  };

  fs.writeFileSync(
    path.join(targetDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8'
  );

  // Update latest mirror
  try {
    if (fs.existsSync(latestDir)) {
      fs.rmSync(latestDir, { recursive: true, force: true });
    }
    copyFolderSync(targetDir, latestDir);
  } catch (e) {
    console.warn('Could not update latest mirror:', e.message);
  }

  console.log('\n========================================================');
  console.log('   🎉 Local Backup Completed Successfully!             ');
  console.log('========================================================');
  console.log(`📁 Backup Folder:   ${targetDir}`);
  console.log(`📁 Latest Mirror:   ${latestDir}`);
  console.log(`📊 Total Documents: ${totalDocumentsCount}`);
  console.log(`💾 Total Size:      ${formatBytes(totalSizeBytes)}`);
  console.log(`⏱️ Duration:        ${durationSec}s`);
  console.log('========================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Backup failed with error:', err);
  process.exit(1);
});
