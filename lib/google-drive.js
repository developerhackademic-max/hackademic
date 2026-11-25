'use strict';

const { HttpError } = require('./firebase-runtime');

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const BROAD_PERMISSION_TYPES = new Set(['anyone', 'domain']);
const PERMISSION_FIELDS = 'permissions(id,type,role,emailAddress,deleted,expirationTime,permissionDetails(inheritedFrom,permissionType,role))';

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function driveError(status, message) {
  if (status === 404) return new HttpError(404, message, 'DRIVE_RESOURCE_NOT_FOUND');
  if (status === 403) return new HttpError(502, 'Google Drive denied the requested operation', 'DRIVE_PERMISSION_DENIED');
  if (status === 429 || status >= 500) return new HttpError(503, 'Google Drive is temporarily unavailable', 'DRIVE_TEMPORARY_FAILURE');
  return new HttpError(502, 'Google Drive request failed', 'DRIVE_REQUEST_FAILED');
}

function createDriveApi(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiBaseUrl = options.apiBaseUrl || 'https://www.googleapis.com/drive/v3';
  const tokenUrl = options.tokenUrl || 'https://oauth2.googleapis.com/token';
  const ownerEmail = normalizedEmail(env.GOOGLE_DRIVE_OWNER_EMAIL);
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN;
  let cachedToken = null;

  function requireConfiguration() {
    if (!clientId || !clientSecret || !refreshToken || !ownerEmail) {
      throw new HttpError(503, 'Google Drive is not configured', 'DRIVE_NOT_CONFIGURED');
    }
  }

  async function accessToken() {
    requireConfiguration();
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
    let response;
    try {
      response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      });
    } catch {
      throw new HttpError(503, 'Google Drive authentication is temporarily unavailable', 'DRIVE_TOKEN_FAILURE');
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new HttpError(502, 'Google Drive authentication returned an invalid response', 'DRIVE_TOKEN_INVALID');
    }
    if (!response.ok || !result.access_token) {
      throw new HttpError(503, 'Google Drive authentication failed', 'DRIVE_TOKEN_FAILURE');
    }
    const scopes = String(result.scope || '').split(/\s+/).filter(Boolean);
    if (!scopes.includes(DRIVE_FILE_SCOPE) || scopes.includes('https://www.googleapis.com/auth/drive')) {
      throw new HttpError(503, 'Google Drive OAuth must use only the drive.file scope', 'DRIVE_SCOPE_INVALID');
    }
    cachedToken = {
      value: result.access_token,
      expiresAt: Date.now() + Math.max(60, Number(result.expires_in) || 3600) * 1000
    };
    return cachedToken.value;
  }

  async function request(resource, init = {}) {
    const url = new URL(`${apiBaseUrl}${resource}`);
    for (const [key, value] of Object.entries(init.query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: init.method || 'GET',
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {})
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'Google Drive is temporarily unavailable', 'DRIVE_NETWORK_FAILURE');
    }
    let result = {};
    if (response.status !== 204) {
      try {
        result = await response.json();
      } catch {
        if (response.ok) throw new HttpError(502, 'Google Drive returned an invalid response', 'DRIVE_RESPONSE_INVALID');
      }
    }
    if (!response.ok) throw driveError(response.status);
    return result;
  }

  return {
    ownerEmail,
    pickerConfig() {
      if (!env.GOOGLE_PICKER_API_KEY || !env.GOOGLE_CLOUD_PROJECT_NUMBER) {
        throw new HttpError(503, 'Google Drive Picker is not configured', 'DRIVE_PICKER_NOT_CONFIGURED');
      }
      return {
        apiKey: env.GOOGLE_PICKER_API_KEY,
        appId: env.GOOGLE_CLOUD_PROJECT_NUMBER
      };
    },
    getAccessToken: accessToken,
    async getFile(fileId) {
      return request(`/files/${encodeURIComponent(fileId)}`, {
        query: {
          fields: 'id,name,mimeType,parents,owners(emailAddress),webViewLink,trashed',
          supportsAllDrives: true
        }
      });
    },
    async listPermissions(fileId) {
      const permissions = [];
      let pageToken;
      do {
        const result = await request(`/files/${encodeURIComponent(fileId)}/permissions`, {
          query: {
            fields: `nextPageToken,${PERMISSION_FIELDS}`,
            pageSize: 100,
            pageToken,
            supportsAllDrives: true
          }
        });
        if (Array.isArray(result.permissions)) permissions.push(...result.permissions);
        pageToken = result.nextPageToken || null;
        if (permissions.length > 2000) {
          throw new HttpError(503, 'The course folder has too many permissions to validate safely', 'DRIVE_PERMISSION_LIMIT');
        }
      } while (pageToken);
      return permissions;
    },
    async createPermission(fileId, { email, expirationTime }) {
      return request(`/files/${encodeURIComponent(fileId)}/permissions`, {
        method: 'POST',
        query: { fields: 'id,type,role,emailAddress,expirationTime', sendNotificationEmail: false },
        body: {
          type: 'user',
          role: 'reader',
          emailAddress: email,
          expirationTime
        }
      });
    },
    async updatePermission(fileId, permissionId, { expirationTime }) {
      return request(`/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, {
        method: 'PATCH',
        query: { fields: 'id,type,role,emailAddress,expirationTime', supportsAllDrives: true },
        body: { role: 'reader', expirationTime }
      });
    },
    async deletePermission(fileId, permissionId) {
      await request(`/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, {
        method: 'DELETE',
        query: { supportsAllDrives: true }
      });
    },
    async getPermission(fileId, permissionId) {
      return request(`/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, {
        query: { fields: 'id,type,role,emailAddress,expirationTime', supportsAllDrives: true }
      });
    }
  };
}

async function validateCourseFolder(drive, folderId) {
  const folder = await drive.getFile(folderId);
  if (folder.trashed || folder.mimeType !== FOLDER_MIME_TYPE) {
    throw new HttpError(400, 'Select an active Google Drive folder');
  }
  const owners = Array.isArray(folder.owners) ? folder.owners : [];
  if (!owners.some(owner => normalizedEmail(owner.emailAddress) === drive.ownerEmail)) {
    throw new HttpError(403, 'The folder must be owned by the Hackademic Drive account');
  }
  const permissions = await drive.listPermissions(folderId);
  if (permissions.some(permission => !permission.deleted && BROAD_PERMISSION_TYPES.has(permission.type))) {
    throw new HttpError(409, 'Remove public or domain-wide access from the course folder before registering it');
  }
  return {
    id: folder.id,
    name: String(folder.name || '').slice(0, 180),
    webViewLink: folder.webViewLink || `https://drive.google.com/drive/folders/${encodeURIComponent(folder.id)}`
  };
}

async function validateCourseVideo(drive, fileId, folderId) {
  const file = await drive.getFile(fileId);
  if (file.trashed || !String(file.mimeType || '').startsWith('video/')) {
    throw new HttpError(400, 'Select an active video file');
  }
  if (!Array.isArray(file.parents) || !file.parents.includes(folderId)) {
    throw new HttpError(403, 'The video must be directly inside its registered course folder');
  }
  const owners = Array.isArray(file.owners) ? file.owners : [];
  if (!owners.some(owner => normalizedEmail(owner.emailAddress) === drive.ownerEmail)) {
    throw new HttpError(403, 'The video must be owned by the Hackademic Drive account');
  }
  const permissions = await drive.listPermissions(fileId);
  if (permissions.some(permission => !permission.deleted && BROAD_PERMISSION_TYPES.has(permission.type))) {
    throw new HttpError(409, 'Remove public or domain-wide access from the video before adding it');
  }
  return {
    id: file.id,
    name: String(file.name || '').slice(0, 180),
    webViewLink: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/preview`
  };
}

async function deletePermissionAndVerify(drive, folderId, permissionId) {
  try {
    await drive.deletePermission(folderId, permissionId);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
  }
  try {
    await drive.getPermission(folderId, permissionId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return;
    throw error;
  }
  throw new HttpError(503, 'Google Drive permission removal could not be verified', 'DRIVE_REVOCATION_UNVERIFIED');
}

module.exports = {
  DRIVE_FILE_SCOPE,
  createDriveApi,
  deletePermissionAndVerify,
  normalizedEmail,
  validateCourseFolder,
  validateCourseVideo
};
