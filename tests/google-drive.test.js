'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HttpError } = require('../api/firebase-runtime');
const {
  DRIVE_FILE_SCOPE,
  createDriveApi,
  deletePermissionAndVerify,
  validateCourseFolder,
  validateCourseVideo
} = require('../api/google-drive');

const env = {
  GOOGLE_DRIVE_OWNER_EMAIL: 'drive-owner@example.test',
  GOOGLE_DRIVE_CLIENT_ID: 'client-id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'client-secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh-token',
  GOOGLE_PICKER_API_KEY: 'picker-key',
  GOOGLE_CLOUD_PROJECT_NUMBER: '123456789'
};

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('Drive API refreshes with drive.file and creates a direct Viewer permission', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://oauth.test/token') {
      return jsonResponse(200, {
        access_token: 'short-lived-token',
        expires_in: 3600,
        scope: `openid ${DRIVE_FILE_SCOPE}`
      });
    }
    return jsonResponse(200, {
      id: 'permission-1',
      type: 'user',
      role: 'reader',
      emailAddress: 'student@example.test',
      expirationTime: '2027-01-01T00:00:00.000Z'
    });
  };
  const drive = createDriveApi({
    env,
    fetchImpl,
    tokenUrl: 'https://oauth.test/token',
    apiBaseUrl: 'https://drive.test/v3'
  });
  const permission = await drive.createPermission('course-folder', {
    email: 'student@example.test',
    expirationTime: '2027-01-01T00:00:00.000Z'
  });
  assert.equal(permission.id, 'permission-1');
  const tokenRequest = new URLSearchParams(calls[0].options.body);
  assert.equal(tokenRequest.get('grant_type'), 'refresh_token');
  assert.equal(tokenRequest.get('client_secret'), 'client-secret');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer short-lived-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    type: 'user',
    role: 'reader',
    emailAddress: 'student@example.test',
    expirationTime: '2027-01-01T00:00:00.000Z'
  });
  assert.equal(new URL(calls[1].url).searchParams.get('sendNotificationEmail'), 'false');
});

test('Drive rejects a broad OAuth scope instead of requesting the Drive API', async () => {
  let driveRequests = 0;
  const drive = createDriveApi({
    env,
    tokenUrl: 'https://oauth.test/token',
    apiBaseUrl: 'https://drive.test/v3',
    fetchImpl: async url => {
      if (String(url) === 'https://oauth.test/token') {
        return jsonResponse(200, {
          access_token: 'wide-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive'
        });
      }
      driveRequests += 1;
      return jsonResponse(200, {});
    }
  });
  await assert.rejects(drive.listPermissions('folder'), error =>
    error instanceof HttpError && error.code === 'DRIVE_SCOPE_INVALID'
  );
  assert.equal(driveRequests, 0);
});

test('course folder validation rejects public access and unowned folders', async () => {
  const folder = {
    id: 'course-folder-123',
    name: 'Course videos',
    mimeType: 'application/vnd.google-apps.folder',
    owners: [{ emailAddress: 'drive-owner@example.test' }]
  };
  const publicDrive = {
    ownerEmail: env.GOOGLE_DRIVE_OWNER_EMAIL,
    getFile: async () => folder,
    listPermissions: async () => [{ id: 'public', type: 'anyone', role: 'reader' }]
  };
  await assert.rejects(validateCourseFolder(publicDrive, folder.id), error =>
    error instanceof HttpError && error.status === 409
  );

  const unownedDrive = {
    ...publicDrive,
    getFile: async () => ({ ...folder, owners: [{ emailAddress: 'other@example.test' }] }),
    listPermissions: async () => []
  };
  await assert.rejects(validateCourseFolder(unownedDrive, folder.id), error =>
    error instanceof HttpError && error.status === 403
  );
});

test('course videos must be directly in the registered course folder', async () => {
  const drive = {
    ownerEmail: env.GOOGLE_DRIVE_OWNER_EMAIL,
    listPermissions: async () => [],
    getFile: async () => ({
      id: 'video-file-123',
      name: 'Class.mp4',
      mimeType: 'video/mp4',
      parents: ['other-folder'],
      owners: [{ emailAddress: env.GOOGLE_DRIVE_OWNER_EMAIL }]
    })
  };
  await assert.rejects(validateCourseVideo(drive, 'video-file-123', 'course-folder'), error =>
    error instanceof HttpError && error.status === 403
  );
});

test('permission revocation succeeds only after Drive confirms the permission is absent', async () => {
  let exists = true;
  const drive = {
    deletePermission: async () => { exists = false; },
    getPermission: async () => {
      if (!exists) throw new HttpError(404, 'Not found');
      return { id: 'permission-1' };
    }
  };
  await deletePermissionAndVerify(drive, 'folder', 'permission-1');

  const unverifiedDrive = {
    deletePermission: async () => {},
    getPermission: async () => ({ id: 'permission-1' })
  };
  await assert.rejects(deletePermissionAndVerify(unverifiedDrive, 'folder', 'permission-1'), error =>
    error instanceof HttpError && error.code === 'DRIVE_REVOCATION_UNVERIFIED'
  );
});
