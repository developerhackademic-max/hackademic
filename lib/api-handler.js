'use strict';

const {
  HttpError,
  clearSessionCookies,
  confirmPasswordReset,
  createSessionFromIdToken,
  firebase,
  guard,
  now,
  readJson,
  requestPasswordReset,
  requireCsrf,
  requireUser,
  sendJson,
  signIn
} = require('./firebase-runtime');
const {
  createDriveApi,
  deletePermissionAndVerify,
  normalizedEmail,
  validateCourseFolder,
  validateCourseVideo
} = require('./google-drive');
const { assertLinkedGoogleIdentity, verifyLinkedGoogleIdentity } = require('./google-identity');
const { allocateId, create, findOne, getById, list, query, remove, save, sortIdDescending } = require('./firestore-store');
const { getSeoPages } = require('./seo');

const quotationServices = [
  'Security Audit & Assessment',
  'Vulnerability Assessment & Penetration Testing',
  'Corporate Training Program',
  'Government Training Program',
  'Web Application Security',
  'Network Security Assessment',
  'Compliance & Certification Support',
  'Managed Security Services',
  'Graphic Design Services',
  'Web Development',
  'Digital Marketing Services',
  'Other'
];
const quotationBudgets = [
  'Below ₹50,000',
  '₹50,000 - ₹1,00,000',
  '₹1,00,000 - ₹5,00,000',
  '₹5,00,000 - ₹10,00,000',
  'Above ₹10,00,000',
  'Not Sure / Need Consultation'
];
const quotationTimelines = [
  'Immediate (Within 1 week)',
  '1 - 2 Weeks',
  '1 Month',
  '2 - 3 Months',
  'Flexible'
];
function id(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, 'Invalid ID');
  return parsed;
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function emailAddress(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Invalid email');
  return email;
}

function objectById(items) {
  return new Map(items.map(item => [Number(item.id), item]));
}

async function recordAudit(firestore, user, action, resource, details = '') {
  await create(firestore, 'audit_logs', {
    actor_id: user?.id || null,
    action,
    resource,
    details: typeof details === 'string' ? details.slice(0, 2000) : JSON.stringify(details).slice(0, 2000),
    created_at: now()
  });
}

function isActiveDriveEnrollment(enrollment) {
  const expiry = Date.parse(enrollment.expires_at || '');
  return enrollment.status === 'active' && enrollment.drive_access_status === 'granted'
    && Number.isFinite(expiry) && expiry > Date.now();
}

async function revokeDriveEnrollment(firestore, enrollment, user, finalStatus) {
  const enrollmentRef = firestore.collection('enrollments').doc(String(enrollment.id));
  const permissionRef = firestore.collection('drive_permissions').doc(String(enrollment.id));
  const permissionSnapshot = await permissionRef.get();
  const permission = permissionSnapshot.exists ? permissionSnapshot.data() : null;
  if (enrollment.drive_access_status === 'granted'
    && (!permission?.permission_id || !permission.folder_id)) {
    throw new HttpError(409, 'Drive permission record is missing; reconcile access before revoking');
  }
  await enrollmentRef.set({
    status: 'revoking',
    drive_access_status: 'revoking',
    updated_at: now()
  }, { merge: true });

  if (permission?.folder_id && (permission.permission_id
    || ['failed', 'granting', 'revocation_failed'].includes(permission.status))) {
    try {
      const drive = createDriveApi();
      let permissionId = permission.permission_id;
      if (!permissionId && Array.isArray(permission.baseline_permission_ids)) {
        const current = await drive.listPermissions(permission.folder_id);
        const matches = current.filter(item => !item.deleted && item.type === 'user'
          && normalizedEmail(item.emailAddress) === normalizedEmail(permission.email));
        const baseline = permission.baseline_permission_ids;
        const possibleAppGrants = matches.filter(item => !baseline.includes(item.id));
        if (possibleAppGrants.length > 1 || (!possibleAppGrants.length && matches.length)) {
          throw new HttpError(409, 'A Drive permission cannot be safely attributed to this enrollment');
        }
        permissionId = possibleAppGrants[0]?.id || null;
      }
      if (permissionId) {
        await deletePermissionAndVerify(drive, permission.folder_id, permissionId);
      }
      permission.permission_id = permissionId;
    } catch (error) {
      await permissionRef.set({
        status: 'revocation_failed',
        failure_code: error.code || 'DRIVE_REVOCATION_FAILED',
        updated_at: now()
      }, { merge: true });
      await recordAudit(firestore, user, 'revoke_failed', 'drive_permission', {
        enrollment_id: enrollment.id,
        course_id: enrollment.course_id,
        permission_id: permission.permission_id,
        error_code: error.code || 'DRIVE_REVOCATION_FAILED'
      });
      throw error;
    }
  }

  if (permissionSnapshot.exists) {
    await permissionRef.set({ status: 'revoked', updated_at: now() }, { merge: true });
  }
  await enrollmentRef.set({
    status: finalStatus,
    drive_access_status: 'revoked',
    updated_at: now(),
    revoked_at: now(),
    revoked_by: user?.id || null
  }, { merge: true });
  await recordAudit(firestore, user, 'revoke', 'drive_permission', {
    enrollment_id: enrollment.id,
    course_id: enrollment.course_id,
    permission_id: permission?.permission_id || null,
    outcome: 'verified_absent',
    enrollment_status: finalStatus
  });
}

async function activeStudentEnrollments(auth, firestore, user, verifyIdentity = true) {
  if (verifyIdentity) {
    let account;
    try {
      account = await auth.getUser(user.auth_uid);
    } catch (error) {
      if (error.code === 'auth/user-not-found') throw new HttpError(403, 'Firebase account is unavailable');
      throw error;
    }
    assertLinkedGoogleIdentity(account, user.email);
  }
  const enrollments = await query(firestore, 'enrollments', 'user_id', '==', user.id);
  const active = [];
  for (const enrollment of enrollments) {
    if (enrollment.status === 'active' && Number.isFinite(Date.parse(enrollment.expires_at || ''))
      && Date.parse(enrollment.expires_at) <= Date.now()) {
      await revokeDriveEnrollment(firestore, enrollment, user, 'expired');
    } else if (isActiveDriveEnrollment(enrollment)) {
      active.push(enrollment);
    }
  }
  return active;
}

function driveExpiration(body) {
  const date = String(body.expiry_date || '').trim();
  if (!validDateOnly(date)) throw new HttpError(400, 'A valid enrollment expiry date is required');
  const expiration = new Date(`${date}T23:59:59.000Z`);
  const current = Date.now();
  const maxExpiration = current + 365 * 24 * 60 * 60 * 1000;
  if (expiration.getTime() <= current + 60 * 60 * 1000 || expiration.getTime() > maxExpiration) {
    throw new HttpError(400, 'Choose an expiry date within the next year');
  }
  return expiration.toISOString();
}

async function grantDriveEnrollment(firestore, enrollment, student, folder, expirationTime, user, drive) {
  const permissionRef = firestore.collection('drive_permissions').doc(String(enrollment.id));
  const currentTime = Date.now();
  const claim = await firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(permissionRef);
    const record = snapshot.exists ? snapshot.data() : {};
    if (record.status === 'revoking') throw new HttpError(409, 'Drive permission is being revoked');
    if (record.status === 'granting' && Date.parse(record.updated_at || '') > currentTime - 120_000) {
      throw new HttpError(409, 'Drive permission request is already in progress');
    }
    if (record.status === 'granted' && record.permission_id
      && record.folder_id === folder.folder_id
      && normalizedEmail(record.email) === normalizedEmail(student.email)
      && record.expires_at === expirationTime) {
      return { alreadyGranted: true, record };
    }
    transaction.set(permissionRef, {
      ...record,
      enrollment_id: enrollment.id,
      course_id: enrollment.course_id,
      student_id: student.id,
      email: student.email,
      folder_id: folder.folder_id,
      expires_at: expirationTime,
      status: 'granting',
      updated_by: user.id,
      updated_at: now()
    }, { merge: true });
    return { alreadyGranted: false, record };
  });
  if (claim.alreadyGranted) return claim.record;
  const previous = claim.record || {};

  let grantedRecord;
  try {
    let permission = null;
    const previousPermissionId = previous.permission_id
      && previous.folder_id === folder.folder_id
      && normalizedEmail(previous.email) === normalizedEmail(student.email)
      ? previous.permission_id : null;

    if (previousPermissionId) {
      try {
        const existing = await drive.getPermission(folder.folder_id, previousPermissionId);
        if (existing.type !== 'user' || normalizedEmail(existing.emailAddress) !== normalizedEmail(student.email)) {
          throw new HttpError(409, 'Stored Drive permission does not match this student');
        }
        permission = await drive.updatePermission(folder.folder_id, previousPermissionId, { expirationTime });
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404) throw error;
      }
    }

    if (!permission) {
      const currentPermissions = await drive.listPermissions(folder.folder_id);
      const matches = currentPermissions.filter(item => !item.deleted && item.type === 'user'
        && normalizedEmail(item.emailAddress) === normalizedEmail(student.email));
      const baselineIds = Array.isArray(previous.baseline_permission_ids)
        ? previous.baseline_permission_ids : [];
      const recovered = matches.filter(item => !baselineIds.includes(item.id));
      const canRecover = ['failed', 'granting'].includes(previous.status);
      if (canRecover && recovered.length === 1 && baselineIds.length) {
        permission = await drive.updatePermission(folder.folder_id, recovered[0].id, { expirationTime });
      } else if (matches.length) {
        throw new HttpError(409, 'A matching Drive permission already exists; verify it before granting access');
      } else {
        const baseline = currentPermissions.map(item => item.id).filter(Boolean);
        await permissionRef.set({ baseline_permission_ids: baseline }, { merge: true });
        permission = await drive.createPermission(folder.folder_id, {
          email: student.email,
          expirationTime
        });
      }
    }
    if (!permission?.id) throw new HttpError(502, 'Google Drive did not return a permission ID');
    const verifiedPermission = await drive.getPermission(folder.folder_id, permission.id);
    const confirmedExpiry = Date.parse(verifiedPermission.expirationTime || '');
    const requestedExpiry = Date.parse(expirationTime);
    if (verifiedPermission.type !== 'user' || verifiedPermission.role !== 'reader'
      || normalizedEmail(verifiedPermission.emailAddress) !== normalizedEmail(student.email)
      || !Number.isFinite(confirmedExpiry) || Math.abs(confirmedExpiry - requestedExpiry) > 1000) {
      throw new HttpError(502, 'Google Drive did not confirm the requested Viewer permission and expiry');
    }
    grantedRecord = {
      enrollment_id: enrollment.id,
      course_id: enrollment.course_id,
      student_id: student.id,
      email: student.email,
      folder_id: folder.folder_id,
      permission_id: verifiedPermission.id,
      expires_at: expirationTime,
      status: 'granted',
      updated_by: user.id,
      updated_at: now()
    };
    await permissionRef.set(grantedRecord, { merge: true });
    await firestore.collection('enrollments').doc(String(enrollment.id)).set({
      drive_access_status: 'granted',
      expires_at: expirationTime,
      updated_at: now()
    }, { merge: true });
  } catch (error) {
    await permissionRef.set({
      status: 'failed',
      failure_code: error.code || 'DRIVE_GRANT_FAILED',
      updated_by: user.id,
      updated_at: now()
    }, { merge: true });
    await firestore.collection('enrollments').doc(String(enrollment.id)).set({
      drive_access_status: 'error',
      updated_at: now()
    }, { merge: true });
    await recordAudit(firestore, user, 'grant_failed', 'drive_permission', {
      enrollment_id: enrollment.id,
      course_id: enrollment.course_id,
      student_id: student.id,
      error_code: error.code || 'DRIVE_GRANT_FAILED'
    });
    throw error;
  }
  await recordAudit(firestore, user, 'grant', 'drive_permission', {
    enrollment_id: enrollment.id,
    course_id: enrollment.course_id,
    student_id: student.id,
    permission_id: grantedRecord.permission_id,
    expires_at: expirationTime,
    outcome: 'granted'
  });
  return grantedRecord;
}

async function activateEnrollmentWithDrive(firestore, auth, enrollment, user, body, action) {
  const expirationTime = driveExpiration(body);
  const [student, course] = await Promise.all([
    getById(firestore, 'users', enrollment.user_id),
    getById(firestore, 'courses', enrollment.course_id)
  ]);
  if (!student || student.role !== 'student' || !student.active) {
    throw new HttpError(404, 'Active student not found');
  }
  if (!course) throw new HttpError(404, 'Course not found');
  const folderSnapshot = await firestore.collection('drive_course_folders')
    .doc(String(enrollment.course_id)).get();
  if (!folderSnapshot.exists) throw new HttpError(409, 'Register a Google Drive folder for this course first');
  const folderRecord = folderSnapshot.data();
  const drive = createDriveApi();
  const folder = await validateCourseFolder(drive, folderRecord.folder_id);
  let account;
  try {
    account = await auth.getUser(student.auth_uid);
  } catch (error) {
    if (error.code === 'auth/user-not-found') throw new HttpError(409, 'Student Firebase account was not found');
    throw error;
  }
  assertLinkedGoogleIdentity(account, student.email);

  const enrollmentRef = firestore.collection('enrollments').doc(String(enrollment.id));
  const currentStatus = enrollment.status;
  if (currentStatus === 'revoking' || currentStatus === 'pending' && action === 'renew') {
    throw new HttpError(409, 'Enrollment is not eligible for this action');
  }
  await enrollmentRef.set({
    status: 'active',
    drive_access_status: 'granting',
    expires_at: expirationTime,
    approved_at: now(),
    approved_by: user.id,
    updated_at: now()
  }, { merge: true });

  const savedFolder = { ...folderRecord, folder_id: folder.id };
  const permission = await grantDriveEnrollment(
    firestore, enrollment, student, savedFolder, expirationTime, user, drive
  );
  await recordAudit(firestore, user, action, 'enrollment', {
    enrollment_id: enrollment.id,
    course_id: course.id,
    student_id: student.id,
    permission_id: permission.permission_id,
    expires_at: expirationTime,
    outcome: 'active'
  });
  return { enrollment_id: enrollment.id, status: 'active', expires_at: expirationTime };
}

async function createPortalUser(auth, firestore, { name, email, password, role, phone = '' }) {
  if (password.length < 12) throw new HttpError(400, 'Password must have 12 characters');
  if (await findOne(firestore, 'users', 'email', email)) throw new HttpError(409, 'Email already belongs to an account');
  try {
    await auth.getUserByEmail(email);
    throw new HttpError(409, 'Email already belongs to an account');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.code !== 'auth/user-not-found') throw error;
  }
  const userId = await allocateId(firestore, 'users');
  let account;
  try {
    account = await auth.createUser({ email, displayName: name, password, disabled: false });
    await auth.setCustomUserClaims(account.uid, {
      role,
      legacyUserId: userId,
      passwordResetRequired: false
    });
    await create(firestore, 'users', {
      name,
      email,
      role,
      active: 1,
      phone,
      created_at: now(),
      auth_uid: account.uid,
      password_reset_required: false
    }, userId);
  } catch (error) {
    if (account) {
      try {
        await auth.deleteUser(account.uid);
      } catch (cleanupError) {
        console.error('Firebase account rollback failed:', cleanupError.code || cleanupError.message);
      }
    }
    throw error;
  }
  return userId;
}

async function getPublicCertificate(firestore, code) {
  const certificates = await list(firestore, 'certificates');
  const certificate = certificates.find(item => String(item.code).toLowerCase() === code.toLowerCase());
  if (!certificate) return null;
  const [user, course] = await Promise.all([
    getById(firestore, 'users', certificate.user_id),
    getById(firestore, 'courses', certificate.course_id)
  ]);
  if (!user || !course) return null;
  return {
    code: certificate.code,
    name: user.name,
    course: course.title,
    issued_at: certificate.issued_at
  };
}

async function publicApi(request, response, path, method, body, firestore) {
  if (path === '/api/courses' && method === 'GET') {
    const items = (await list(firestore, 'courses')).filter(course => course.published === 1)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(a.id) - Number(b.id))
      .map(({ id, slug, title, category, description, level, duration, price, icon, featured }) =>
        ({ id, slug, title, category, description, level, duration, price, icon, featured }));
    return sendJson(response, 200, { items });
  }
  if (path === '/api/services' && method === 'GET') {
    const items = (await list(firestore, 'services')).filter(service => service.published === 1)
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map(({ id, title, slug, description }) => ({ id, title, slug, description }));
    return sendJson(response, 200, { items });
  }
  if (path === '/api/blog' && method === 'GET') {
    const items = (await list(firestore, 'blog_posts')).filter(post => post.status === 'published')
      .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)) || Number(b.id) - Number(a.id))
      .map(({ id, title, slug, excerpt, published_at }) => ({ id, title, slug, excerpt, published_at }));
    return sendJson(response, 200, { items });
  }
  const blogMatch = path.match(/^\/api\/blog\/([a-z0-9-]+)$/);
  if (blogMatch && method === 'GET') {
    const post = await findOne(firestore, 'blog_posts', 'slug', blogMatch[1]);
    if (!post || post.status !== 'published') throw new HttpError(404, 'Blog post not found');
    return sendJson(response, 200, {
      post: {
        id: post.id, title: post.title, slug: post.slug, excerpt: post.excerpt,
        content: post.content, published_at: post.published_at
      }
    });
  }
  if (path === '/api/jobs' && method === 'GET') {
    const items = (await list(firestore, 'jobs')).filter(job => job.status === 'open')
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map(({ id, title, department, location, type, description }) =>
        ({ id, title, department, location, type, description }));
    return sendJson(response, 200, { items });
  }
  if (path === '/api/certificates/verify' && method === 'GET') {
    const code = String(new URL(request.url, 'https://local.invalid').searchParams.get('code') || '').trim();
    if (!code || code.length > 100) throw new HttpError(400, 'Certificate number is required');
    const certificate = await getPublicCertificate(firestore, code);
    return sendJson(response, 200, certificate ? { valid: true, certificate } : { valid: false });
  }
  if (path === '/api/leads' && method === 'POST') {
    const name = String(body.name ?? '').trim().slice(0, 100);
    const email = emailAddress(body.email);
    const interest = String(body.interest ?? '').trim().slice(0, 120);
    if (!name) throw new HttpError(400, 'Name is required');
    if (!interest) throw new HttpError(400, 'Interest is required');
    await create(firestore, 'leads', {
      name, email, phone: String(body.phone ?? '').trim().slice(0, 30), interest,
      message: String(body.message ?? '').trim().slice(0, 1500),
      status: 'new', source: 'website', created_at: now()
    });
    return sendJson(response, 201, { ok: true, message: 'Enquiry received' });
  }
  if (path === '/api/quotations' && method === 'POST') {
    const companyName = String(body.companyName ?? '').trim().slice(0, 150);
    const name = String(body.name ?? '').trim().slice(0, 100);
    const designation = String(body.designation ?? '').trim().slice(0, 120);
    const email = emailAddress(body.email);
    const phone = String(body.phone ?? '').trim();
    const service = String(body.service ?? '').trim();
    if (!companyName) throw new HttpError(400, 'Company Name is required');
    if (!name) throw new HttpError(400, 'Your Name is required');
    if (!/^\d{10}$/.test(phone)) throw new HttpError(400, 'Phone must be 10 digits');
    if (!quotationServices.includes(service)
      && !(await list(firestore, 'services')).some(item => item.title === service && item.published === 1)) {
      throw new HttpError(400, 'Invalid service');
    }
    const budget = String(body.estimatedBudget ?? '').trim();
    const timeline = String(body.timeline ?? '').trim();
    if (budget && !quotationBudgets.includes(budget)) throw new HttpError(400, 'Invalid estimated budget');
    if (timeline && !quotationTimelines.includes(timeline)) throw new HttpError(400, 'Invalid timeline');
    const description = String(body.projectDescription ?? '').trim().slice(0, 5000);
    const requirements = String(body.additionalRequirements ?? '').trim().slice(0, 5000);
    if (!description) throw new HttpError(400, 'Project Description is required');
    if (description.split(/\s+/).filter(Boolean).length > 200
      || requirements.split(/\s+/).filter(Boolean).length > 200) {
      throw new HttpError(400, 'Descriptions must not exceed 200 words');
    }
    const message = [
      `Company Name: ${companyName}`,
      `Designation: ${designation || 'Not provided'}`,
      `Estimated Budget: ${budget || 'Not selected'}`,
      `Timeline: ${timeline || 'Not selected'}`,
      `Project Description: ${description}`,
      `Additional Requirements: ${requirements || 'Not provided'}`
    ].join('\n');
    await create(firestore, 'leads', {
      name, email, phone, interest: service, message, source: 'quotation',
      status: 'new', created_at: now()
    });
    return sendJson(response, 201, { ok: true, message: 'Quotation request received' });
  }
  if (path === '/api/applications' && method === 'POST') {
    const jobId = id(body.job_id);
    const job = await getById(firestore, 'jobs', jobId);
    if (!job || job.status !== 'open') throw new HttpError(404, 'Job unavailable');
    const email = emailAddress(body.email);
    const name = String(body.name ?? '').trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'Name is required');
    await create(firestore, 'applications', {
      job_id: jobId,
      name,
      email,
      phone: String(body.phone ?? '').trim().slice(0, 30),
      resume_url: String(body.resume_url ?? '').trim().slice(0, 500),
      cover_letter: String(body.cover_letter ?? '').trim().slice(0, 2000),
      status: 'applied',
      created_at: now()
    });
    return sendJson(response, 201, { ok: true });
  }
  return false;
}

async function handler(request, response) {
  try {
    const url = new URL(request.url, 'https://local.invalid');
    const path = url.pathname;
    const method = request.method || 'GET';
    const body = ['GET', 'HEAD'].includes(method) ? {} : await readJson(request);
    if (path === '/api/health' && method === 'GET') return sendJson(response, 200, { ok: true });

    if (path === '/api/auth/config' && method === 'GET') {
      const config = {
        apiKey: process.env.FIREBASE_WEB_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
        appId: process.env.FIREBASE_WEB_APP_ID
      };
      if (Object.values(config).some(value => !value)) {
        throw new HttpError(503, 'Firebase client authentication is not configured');
      }
      if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        if (!config.projectId.startsWith('demo-')) {
          throw new Error('Firebase emulators may only be used with a demo-* project ID.');
        }
        config.authEmulatorUrl = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
      }
      return sendJson(response, 200, config);
    }

    const { auth, firestore } = firebase();

    if (path === '/api/auth/login' && method === 'POST') {
      const result = await signIn(request, response, auth, firestore, body);
      return sendJson(response, 200, result);
    }
    if (path === '/api/auth/session' && method === 'POST') {
      return sendJson(response, 200, await createSessionFromIdToken(response, auth, firestore, body));
    }
    if (path === '/api/auth/link-google' && method === 'POST') {
      const user = await requireUser(request, auth, firestore);
      requireCsrf(request, user);
      guard(user, ['student']);
      const { provider } = await verifyLinkedGoogleIdentity(auth, user, body.idToken);
      await recordAudit(firestore, user, 'link', 'google_account', {
        student_id: user.id,
        email: normalizedEmail(provider.email),
        outcome: 'verified'
      });
      return sendJson(response, 200, { ok: true, linked: true });
    }
    if (path === '/api/auth/google-link-status' && method === 'GET') {
      const user = await requireUser(request, auth, firestore);
      guard(user, ['student']);
      const account = await auth.getUser(user.auth_uid);
      const googleProvider = (account.providerData || []).find(item => item.providerId === 'google.com');
      const linked = Boolean(googleProvider);
      const matches = linked && normalizedEmail(account.email) === normalizedEmail(user.email)
        && normalizedEmail(googleProvider.email) === normalizedEmail(user.email);
      return sendJson(response, 200, {
        linked: Boolean(matches),
        emailVerified: Boolean(account.emailVerified),
        emailMatches: Boolean(matches)
      });
    }
    if (path === '/api/auth/reset/request' && method === 'POST') {
      return sendJson(response, 200, await requestPasswordReset(request, body));
    }
    if (path === '/api/auth/reset/confirm' && method === 'POST') {
      return sendJson(response, 200, await confirmPasswordReset(body, auth, firestore));
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      const user = await requireUser(request, auth, firestore);
      requireCsrf(request, user);
      clearSessionCookies(response);
      return sendJson(response, 200, { ok: true });
    }
    if (path === '/api/auth/me' && method === 'GET') {
      try {
        const user = await requireUser(request, auth, firestore);
        return sendJson(response, 200, {
          user: { id: user.id, name: user.name, email: user.email, role: user.role },
          csrf: user.csrf
        });
      } catch (error) {
        if (error.status === 401) return sendJson(response, 200, { user: null, csrf: null });
        throw error;
      }
    }
    const publicResponse = await publicApi(request, response, path, method, body, firestore);
    if (publicResponse !== false) return publicResponse;

    return await protectedApi(request, response, path, method, body, auth, firestore);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!response.headersSent) {
      return sendJson(response, status, { error: status === 500 ? 'Server error' : error.message });
    }
    response.destroy(error);
  }
}

function withoutInternalFields(record) {
  const { _docId, ...value } = record;
  return value;
}

async function protectedApi(request, response, path, method, body, auth, firestore) {
  const user = await requireUser(request, auth, firestore);
  if (!['GET', 'HEAD'].includes(method)) requireCsrf(request, user);

  if (path === '/api/manage/drive-picker' && method === 'GET') {
    guard(user, ['admin']);
    const drive = createDriveApi();
    return sendJson(response, 200, {
      ...drive.pickerConfig(),
      accessToken: await drive.getAccessToken(),
      expiresIn: 3600
    });
  }
  if (path === '/api/manage/course-drive-folders' && method === 'GET') {
    guard(user, ['admin', 'hr']);
    const [folders, courses] = await Promise.all([
      list(firestore, 'drive_course_folders'), list(firestore, 'courses')
    ]);
    return sendJson(response, 200, {
      items: folders.map(folder => ({
        course_id: Number(folder.course_id),
        course: courses.find(course => Number(course.id) === Number(folder.course_id))?.title || '',
        folder_id: folder.folder_id,
        folder_name: folder.folder_name,
        folder_url: folder.folder_url
      }))
    });
  }
  if (path === '/api/manage/course-drive-folder' && method === 'POST') {
    guard(user, ['admin']);
    const courseId = id(body.course_id);
    if (!await getById(firestore, 'courses', courseId)) throw new HttpError(404, 'Course not found');
    const folderId = String(body.folder_id || '').trim();
    if (!/^[A-Za-z0-9_-]{10,256}$/.test(folderId)) throw new HttpError(400, 'Invalid Google Drive folder ID');
    const drive = createDriveApi();
    const selected = await validateCourseFolder(drive, folderId);
    const mappingRef = firestore.collection('drive_course_folders').doc(String(courseId));
    const existingMapping = await mappingRef.get();
    if (existingMapping.exists && existingMapping.data().folder_id !== selected.id) {
      const activePermissions = (await list(firestore, 'drive_permissions')).some(permission =>
        Number(permission.course_id) === courseId && permission.status !== 'revoked'
      );
      if (activePermissions) {
        throw new HttpError(409, 'Revoke active course permissions before changing its Drive folder');
      }
    }
    const record = {
      course_id: courseId,
      folder_id: selected.id,
      folder_name: selected.name,
      folder_url: selected.webViewLink,
      updated_by: user.id,
      updated_at: now()
    };
    await mappingRef.set(record, { merge: true });
    await recordAudit(firestore, user, 'register', 'drive_course_folder', {
      course_id: courseId,
      folder_id: selected.id,
      outcome: 'registered'
    });
    return sendJson(response, 200, { ok: true, folder: record });
  }

  if (path === '/api/my/tasks' && method === 'GET') {
    guard(user, ['employee']);
    const employee = (await list(firestore, 'employees'))
      .find(item => item.email.toLowerCase() === user.email.toLowerCase() && item.status === 'active');
    if (!employee) throw new HttpError(403, 'Employee profile is not active');
    const items = (await query(firestore, 'tasks', 'employee_id', '==', employee.id))
      .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed')
        || String(a.due_date).localeCompare(String(b.due_date)) || Number(a.id) - Number(b.id))
      .map(withoutInternalFields);
    return sendJson(response, 200, { items });
  }
  if (path === '/api/my/task' && method === 'POST') {
    guard(user, ['employee']);
    const taskId = id(body.id);
    const employee = (await list(firestore, 'employees'))
      .find(item => item.email.toLowerCase() === user.email.toLowerCase() && item.status === 'active');
    if (!employee) throw new HttpError(403, 'Employee profile is not active');
    const task = await getById(firestore, 'tasks', taskId);
    if (!task || Number(task.employee_id) !== Number(employee.id)) throw new HttpError(404, 'Task not found');
    let status = String(body.status || '');
    let progress = Number(body.progress);
    if (!['pending', 'in_progress', 'completed'].includes(status)) throw new HttpError(400, 'Invalid task status');
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw new HttpError(400, 'Progress must be between 0 and 100');
    }
    if (status === 'completed' || progress === 100) {
      status = 'completed';
      progress = 100;
    } else if (status === 'pending' && progress > 0) {
      status = 'in_progress';
    } else if (status === 'pending') {
      progress = 0;
    }
    await save(firestore, 'tasks', taskId, { status, progress, updated_at: now() });
    await recordAudit(firestore, user, 'update', 'task');
    return sendJson(response, 200, { ok: true, status, progress });
  }
  if (path === '/api/dashboard' && method === 'GET') {
    const [coursesAll, services, employees, certificates, posts, applications, leads, leaves, enrollments,
      progress, attempts, submissions, lessons, assignments, instructorCourses, tasks, announcements] = await Promise.all([
      list(firestore, 'courses'), list(firestore, 'services'), list(firestore, 'employees'),
      list(firestore, 'certificates'), list(firestore, 'blog_posts'), list(firestore, 'applications'),
      list(firestore, 'leads'), list(firestore, 'leave_requests'), list(firestore, 'enrollments'),
      list(firestore, 'lesson_progress'), list(firestore, 'attempts'), list(firestore, 'assignment_submissions'),
      list(firestore, 'lessons'), list(firestore, 'assignments'),
      query(firestore, 'courses', 'instructor_id', '==', user.id), query(firestore, 'tasks', 'employee_id', '==', -1),
      list(firestore, 'announcements')
    ]);
    let stats = {};
    let courseItems = [];
    let recommendations = [];
    if (user.role === 'admin') {
      stats = {
        courses: coursesAll.length, services: services.length, teamMembers: employees.length,
        certificates: certificates.length, blogPosts: posts.length, applications: applications.length
      };
    } else if (user.role === 'hr') {
      stats = {
        employees: employees.length,
        pendingLeaves: leaves.filter(item => item.status === 'pending').length,
        enquiries: leads.length
      };
    } else if (user.role === 'student') {
      const myEnrollments = await activeStudentEnrollments(auth, firestore, user, false);
      const courseIds = new Set(myEnrollments.map(item => Number(item.course_id)));
      const myProgress = progress.filter(item => Number(item.user_id) === user.id);
      const myAttempts = attempts.filter(item => Number(item.user_id) === user.id);
      const mySubmissions = submissions.filter(item => Number(item.user_id) === user.id);
      const myLessons = lessons.filter(item => courseIds.has(Number(item.course_id)) && item.published === 1);
      const myAssignments = assignments.filter(item => courseIds.has(Number(item.course_id)) && item.published === 1);
      const progressLessons = new Set(myProgress.map(item => Number(item.lesson_id)));
      stats = {
        enrollments: myEnrollments.length,
        completedLessons: myProgress.length,
        attempts: myAttempts.length,
        classesDone: myProgress.length,
        submissions: mySubmissions.length,
        lecturesAvailable: myLessons.filter(item => Boolean(item.drive_file_id)).length,
        materialsAvailable: myLessons.filter(item => String(item.summary || '').trim()
          || String(item.content || '').trim() || Boolean(item.drive_file_id)).length,
        assignmentsAvailable: myAssignments.length
      };
      courseItems = coursesAll.filter(course => courseIds.has(Number(course.id)))
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map(course => ({ id: course.id, title: course.title }));
      recommendations = myLessons.filter(item => !progressLessons.has(Number(item.id)))
        .sort((a, b) => Number(a.course_id) - Number(b.course_id) || Number(a.sort_order) - Number(b.sort_order))
        .slice(0, 2)
        .map(lesson => ({
          id: lesson.id, course_id: lesson.course_id, title: lesson.title, summary: lesson.summary,
          course: coursesAll.find(course => Number(course.id) === Number(lesson.course_id))?.title || ''
        }));
    } else if (user.role === 'instructor') {
      const courseIds = new Set(instructorCourses.map(item => Number(item.id)));
      stats = {
        courses: instructorCourses.length,
        students: new Set(enrollments.filter(item => courseIds.has(Number(item.course_id))).map(item => item.user_id)).size
      };
    } else if (user.role === 'employee') {
      const employee = employees.find(item => item.email.toLowerCase() === user.email.toLowerCase());
      const ownTasks = employee ? tasks.filter(item => Number(item.employee_id) === Number(employee.id)) : [];
      stats = { tasks: ownTasks.length };
    }
    const audience = user.role === 'hr' ? 'hr' : user.role;
    const announcementsForUser = announcements.filter(item => item.audience === 'all' || item.audience === audience)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, 8)
      .map(({ title, body: text, created_at }) => ({ title, body: text, created_at }));
    return sendJson(response, 200, {
      stats, courses: courseItems, recommendations, announcements: announcementsForUser
    });
  }
  if (path === '/api/manage/seo' && method === 'GET') {
    guard(user, ['admin']);
    const robots = await getById(firestore, 'seo_robots', 1);
    return sendJson(response, 200, { pages: await getSeoPages(firestore), robots_txt: robots?.content || '' });
  }
  if (path === '/api/manage/seo/page' && method === 'POST') {
    guard(user, ['admin']);
    const page = String(body.page || '').trim();
    if (!(await getSeoPages(firestore)).some(item => item.page === page)) throw new HttpError(400, 'Unknown website page');
    const title = String(body.title || '').trim().slice(0, 200);
    const description = String(body.description || '').trim().slice(0, 320);
    const canonical = String(body.canonical || '').trim().slice(0, 500);
    const robots = String(body.robots || '').trim();
    const ogTitle = String(body.og_title || '').trim().slice(0, 200);
    const ogDescription = String(body.og_description || '').trim().slice(0, 320);
    const ogImage = String(body.og_image || '').trim().slice(0, 500);
    const includeSitemap = Number(body.include_sitemap);
    const changefreq = String(body.changefreq || '').trim();
    const priority = Number(body.priority);
    if (!title) throw new HttpError(400, 'SEO title is required');
    let canonicalUrl;
    try { canonicalUrl = new URL(canonical); } catch { throw new HttpError(400, 'Invalid canonical URL'); }
    if (canonicalUrl.protocol !== 'https:' || canonicalUrl.username || canonicalUrl.password) {
      throw new HttpError(400, 'Canonical URL must use HTTPS');
    }
    if (!['index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow'].includes(robots)) {
      throw new HttpError(400, 'Invalid indexing directive');
    }
    if (![0, 1].includes(includeSitemap)) throw new HttpError(400, 'Invalid sitemap setting');
    if (!['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'].includes(changefreq)) {
      throw new HttpError(400, 'Invalid sitemap frequency');
    }
    if (!Number.isFinite(priority) || priority < 0 || priority > 1) {
      throw new HttpError(400, 'Sitemap priority must be between 0 and 1');
    }
    if (ogImage) {
      let imageUrl;
      try { imageUrl = new URL(ogImage); } catch {}
      const localAsset = ogImage.startsWith('/assets/') && !ogImage.split('/').includes('..');
      if (!localAsset && (!imageUrl || imageUrl.protocol !== 'https:' || imageUrl.username || imageUrl.password)) {
        throw new HttpError(400, 'Social image must be an HTTPS URL or a site asset path');
      }
    }
    await firestore.collection('seo_pages').doc(page).set({
      page, title, description, canonical, robots, og_title: ogTitle, og_description: ogDescription,
      og_image: ogImage, include_sitemap: includeSitemap, changefreq, priority, updated_at: now()
    }, { merge: true });
    await recordAudit(firestore, user, 'update', `seo:${page}`);
    return sendJson(response, 200, { ok: true });
  }
  if (path === '/api/manage/seo/robots' && method === 'POST') {
    guard(user, ['admin']);
    const content = String(body.content ?? '').replace(/\r\n/g, '\n').trim();
    if (!content) throw new HttpError(400, 'robots.txt cannot be empty');
    if (content.length > 4000) throw new HttpError(400, 'robots.txt must be 4000 characters or fewer');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const directive = line.match(/^(User-agent|Allow|Disallow|Sitemap):\s*(.*?)\s*$/i);
      if (!directive) throw new HttpError(400, 'Use only User-agent, Allow, Disallow, and Sitemap directives');
      if (directive[1].toLowerCase() === 'sitemap') {
        let sitemap;
        try { sitemap = new URL(directive[2]); } catch { throw new HttpError(400, 'Sitemap directive must be an HTTPS URL'); }
        if (sitemap.protocol !== 'https:') throw new HttpError(400, 'Sitemap directive must be an HTTPS URL');
      }
    }
    await firestore.collection('seo_robots').doc('1').set({ id: 1, content, updated_at: now() });
    await recordAudit(firestore, user, 'update', 'seo:robots.txt');
    return sendJson(response, 200, { ok: true });
  }
  if (path === '/api/my/courses' && method === 'GET') {
    guard(user, ['student']);
    const [enrollments, courses, lessons, progress] = await Promise.all([
      activeStudentEnrollments(auth, firestore, user),
      list(firestore, 'courses'), list(firestore, 'lessons'),
      query(firestore, 'lesson_progress', 'user_id', '==', user.id)
    ]);
    const completed = new Set(progress.map(item => Number(item.lesson_id)));
    const items = enrollments.map(enrollment => {
      const course = courses.find(item => Number(item.id) === Number(enrollment.course_id));
      if (!course) return null;
      const courseLessons = lessons.filter(lesson => Number(lesson.course_id) === Number(course.id) && lesson.published === 1);
      return {
        id: course.id, title: course.title, category: course.category, duration: course.duration,
        status: enrollment.status, lesson_count: courseLessons.length,
        done: courseLessons.filter(lesson => completed.has(Number(lesson.id))).length
      };
    }).filter(Boolean);
    return sendJson(response, 200, { items });
  }
  if (path === '/api/my/profile' && method === 'GET') {
    guard(user, ['student']);
    const enrollments = await activeStudentEnrollments(auth, firestore, user, false);
    const courses = await list(firestore, 'courses');
    return sendJson(response, 200, {
      profile: { id: user.id, name: user.name, email: user.email, phone: user.phone || '' },
      courses: enrollments.map(enrollment => {
        const course = courses.find(item => Number(item.id) === Number(enrollment.course_id));
        return course ? { id: course.id, title: course.title, enrolled_at: enrollment.created_at } : null;
      }).filter(Boolean).sort((a, b) => String(a.enrolled_at).localeCompare(String(b.enrolled_at)))
    });
  }
  if (path === '/api/my/recordings' && method === 'GET') {
    guard(user, ['student']);
    const enrollments = await activeStudentEnrollments(auth, firestore, user);
    const courseIds = new Set(enrollments.map(item => Number(item.course_id)));
    const [courses, lessons] = await Promise.all([list(firestore, 'courses'), list(firestore, 'lessons')]);
    const items = lessons.filter(lesson => courseIds.has(Number(lesson.course_id))
      && lesson.published === 1 && lesson.drive_file_id)
      .sort((a, b) => Number(a.course_id) - Number(b.course_id) || Number(a.sort_order) - Number(b.sort_order))
      .map(lesson => ({
        id: lesson.id, course_id: lesson.course_id, title: lesson.title, summary: lesson.summary,
        video_url: `https://drive.google.com/file/d/${encodeURIComponent(lesson.drive_file_id)}/preview`,
        course: courses.find(course => Number(course.id) === Number(lesson.course_id))?.title || ''
      }));
    return sendJson(response, 200, { items });
  }
  const courseMatch = path.match(/^\/api\/my\/courses\/(\d+)$/);
  if (courseMatch && method === 'GET') {
    const courseId = id(courseMatch[1]);
    const course = await getById(firestore, 'courses', courseId);
    const isInstructor = user.role === 'instructor' && Number(course?.instructor_id) === user.id;
    const isEnrolled = user.role === 'student'
      && (await activeStudentEnrollments(auth, firestore, user))
        .some(enrollment => Number(enrollment.course_id) === courseId);
    if (!course || !(user.role === 'admin' || isInstructor || isEnrolled)) throw new HttpError(403, 'Not enrolled');
    const [lessons, progress, assessments, assignments] = await Promise.all([
      query(firestore, 'lessons', 'course_id', '==', courseId),
      user.role === 'student' ? query(firestore, 'lesson_progress', 'user_id', '==', user.id) : Promise.resolve([]),
      query(firestore, 'assessments', 'course_id', '==', courseId),
      query(firestore, 'assignments', 'course_id', '==', courseId)
    ]);
    const done = new Set(progress.map(item => Number(item.lesson_id)));
    return sendJson(response, 200, {
      course: { id: course.id, title: course.title, description: course.description },
      lessons: lessons.filter(item => item.published === 1)
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .map(item => {
          const value = withoutInternalFields(item);
          value.video_url = item.drive_file_id
            ? `https://drive.google.com/file/d/${encodeURIComponent(item.drive_file_id)}/preview` : '';
          return { ...value, done: Number(done.has(Number(item.id))) };
        }),
      assessments: assessments.filter(item => item.published === 1)
        .map(({ id: itemId, title, pass_score }) => ({ id: itemId, title, pass_score })),
      assignments: assignments.filter(item => item.published === 1)
        .map(({ id: itemId, title, instructions, due_at }) => ({ id: itemId, title, instructions, due_at }))
    });
  }
  if (path === '/api/progress' && method === 'POST') {
    guard(user, ['student']);
    const lessonId = id(body.lesson_id);
    const lesson = await getById(firestore, 'lessons', lessonId);
    const enrollments = await activeStudentEnrollments(auth, firestore, user);
    if (!lesson || !enrollments.some(item => Number(item.course_id) === Number(lesson.course_id))) {
      throw new HttpError(403, 'Not enrolled');
    }
    await firestore.collection('lesson_progress').doc(`${user.id}_${lessonId}`).set({
      user_id: user.id, lesson_id: lessonId, completed_at: now()
    }, { merge: true });
    return sendJson(response, 200, { ok: true });
  }
  const quizMatch = path.match(/^\/api\/assessments\/(\d+)$/);
  if (quizMatch && method === 'GET') {
    guard(user, ['student']);
    const assessment = await getById(firestore, 'assessments', id(quizMatch[1]));
    const enrollments = await activeStudentEnrollments(auth, firestore, user);
    if (!assessment || assessment.published !== 1
      || !enrollments.some(item => Number(item.course_id) === Number(assessment.course_id))) {
      throw new HttpError(403, 'Not enrolled');
    }
    const questions = JSON.parse(assessment.questions_json || '[]');
    return sendJson(response, 200, {
      id: assessment.id, title: assessment.title, pass_score: assessment.pass_score,
      questions: questions.map(({ q, options }) => ({ q, options }))
    });
  }
  if (path === '/api/attempts' && method === 'POST') {
    guard(user, ['student']);
    const assessment = await getById(firestore, 'assessments', id(body.assessment_id));
    const enrollments = await activeStudentEnrollments(auth, firestore, user);
    if (!assessment || assessment.published !== 1
      || !enrollments.some(item => Number(item.course_id) === Number(assessment.course_id))) {
      throw new HttpError(403, 'Not enrolled');
    }
    const questions = JSON.parse(assessment.questions_json || '[]');
    if (!Array.isArray(body.answers) || body.answers.length !== questions.length) {
      throw new HttpError(400, 'Answer all questions');
    }
    const correct = questions.filter((question, index) => Number(body.answers[index]) === Number(question.answer)).length;
    const score = Math.round(correct / Math.max(1, questions.length) * 100);
    const passed = score >= Number(assessment.pass_score);
    await create(firestore, 'attempts', {
      assessment_id: assessment.id, user_id: user.id, answers_json: JSON.stringify(body.answers),
      score, passed: Number(passed), created_at: now()
    });
    return sendJson(response, 201, { score, passed });
  }
  if (path === '/api/submissions' && method === 'POST') {
    guard(user, ['student']);
    const assignment = await getById(firestore, 'assignments', id(body.assignment_id));
    const enrollments = await activeStudentEnrollments(auth, firestore, user);
    if (!assignment || !enrollments.some(item => Number(item.course_id) === Number(assignment.course_id))) {
      throw new HttpError(403, 'Not enrolled');
    }
    const content = String(body.content ?? '').trim().slice(0, 4000);
    if (!content) throw new HttpError(400, 'Submission is required');
    const existing = (await query(firestore, 'assignment_submissions', 'assignment_id', '==', assignment.id))
      .find(item => Number(item.user_id) === user.id);
    if (existing) {
      await save(firestore, 'assignment_submissions', existing.id, { content, submitted_at: now() });
    } else {
      await create(firestore, 'assignment_submissions', {
        assignment_id: assignment.id, user_id: user.id, content, grade: null, feedback: '',
        submitted_at: now(), graded_at: null
      });
    }
    return sendJson(response, 200, { ok: true });
  }
  if (path === '/api/tickets' && method === 'GET') {
    const items = user.role === 'admin' ? await list(firestore, 'tickets')
      : await query(firestore, 'tickets', 'user_id', '==', user.id);
    if (user.role === 'admin') {
      const users = objectById(await list(firestore, 'users'));
      items.forEach(item => { item.name = users.get(Number(item.user_id))?.name || ''; });
    }
    return sendJson(response, 200, { items: sortIdDescending(items).map(withoutInternalFields) });
  }
  if (path === '/api/tickets' && method === 'POST') {
    const subject = String(body.subject || '').trim().slice(0, 140);
    const text = String(body.message || '').trim().slice(0, 2000);
    if (!subject || !text) throw new HttpError(400, 'Subject and message are required');
    await create(firestore, 'tickets', {
      user_id: user.id, subject, message: text, status: 'open', reply: '', created_at: now()
    });
    return sendJson(response, 201, { ok: true });
  }
  if (path === '/api/announcements' && method === 'GET') {
    const items = (await list(firestore, 'announcements'))
      .filter(item => item.audience === 'all' || item.audience === (user.role === 'hr' ? 'hr' : user.role))
      .sort((a, b) => Number(b.id) - Number(a.id));
    return sendJson(response, 200, { items: items.map(withoutInternalFields) });
  }

  const manageTables = {
    leads: { roles: ['admin', 'hr'] },
    courses: { roles: ['admin', 'hr'] },
    services: { roles: ['admin', 'hr'] },
    blog_posts: { roles: ['admin'] },
    enrollments: { roles: ['admin', 'hr'] },
    employees: { roles: ['admin', 'hr'] },
    leave_requests: { roles: ['admin', 'hr'] },
    tasks: { roles: ['admin'] },
    applications: { roles: ['admin', 'hr'] },
    jobs: { roles: ['admin', 'hr'] },
    batches: { roles: ['admin', 'hr'] },
    users: { roles: ['admin', 'hr'] },
    submissions: { roles: ['admin', 'instructor'] }
  };
  const manageMatch = path.match(/^\/api\/manage\/([a-z_]+)$/);
  if (manageMatch && method === 'GET') {
    const table = manageMatch[1];
    const config = manageTables[table];
    if (!config) throw new HttpError(404, 'Not found');
    guard(user, config.roles);
    let items = await list(firestore, table);
    if (table === 'users') {
      items = items.filter(item => item.role === 'student')
        .map(({ id: itemId, name, email, role, active, created_at }) => ({ id: itemId, name, email, role, active, created_at }));
    } else if (table === 'enrollments') {
      const [users, courses] = await Promise.all([list(firestore, 'users'), list(firestore, 'courses')]);
      items = items.map(item => ({
        id: item.id,
        student: users.find(person => Number(person.id) === Number(item.user_id))?.name || '',
        course: courses.find(course => Number(course.id) === Number(item.course_id))?.title || '',
        status: item.status,
        drive_access_status: item.drive_access_status || 'not_granted',
        expires_at: item.expires_at || '',
        created_at: item.created_at
      }));
    } else if (table === 'employees') {
      const users = await list(firestore, 'users');
      items = items.map(item => {
        const account = users.find(person => person.email.toLowerCase() === item.email.toLowerCase());
        return {
          ...withoutInternalFields(item),
          login_status: !account ? 'missing' : account.role === 'employee' && account.active ? 'enabled' : 'conflict'
        };
      });
    } else if (table === 'leave_requests') {
      const employees = objectById(await list(firestore, 'employees'));
      items = items.map(item => ({ ...withoutInternalFields(item), employee: employees.get(Number(item.employee_id))?.name || '' }));
    } else if (table === 'tasks') {
      const employees = objectById(await list(firestore, 'employees'));
      items = items.map(item => ({
        ...withoutInternalFields(item),
        employee: employees.get(Number(item.employee_id))?.name || '',
        employee_email: employees.get(Number(item.employee_id))?.email || ''
      }));
    } else if (table === 'applications') {
      const jobs = objectById(await list(firestore, 'jobs'));
      items = items.map(item => ({ ...withoutInternalFields(item), job: jobs.get(Number(item.job_id))?.title || '' }));
    } else if (table === 'batches') {
      const courses = objectById(await list(firestore, 'courses'));
      items = items.map(item => ({ ...withoutInternalFields(item), course: courses.get(Number(item.course_id))?.title || '' }));
    } else if (table === 'submissions') {
      const [assignments, courses, users] = await Promise.all([
        list(firestore, 'assignments'), list(firestore, 'courses'), list(firestore, 'users')
      ]);
      items = items.filter(submission => {
        const assignment = assignments.find(item => Number(item.id) === Number(submission.assignment_id));
        const course = courses.find(item => Number(item.id) === Number(assignment?.course_id));
        return course && (user.role === 'admin' || Number(course.instructor_id) === user.id);
      }).map(submission => {
        const assignment = assignments.find(item => Number(item.id) === Number(submission.assignment_id));
        const course = courses.find(item => Number(item.id) === Number(assignment?.course_id));
        return {
          ...withoutInternalFields(submission),
          student: users.find(person => Number(person.id) === Number(submission.user_id))?.name || '',
          assignment: assignment?.title || '',
          course: course?.title || ''
        };
      });
    }
    return sendJson(response, 200, { items: sortIdDescending(items).map(withoutInternalFields) });
  }

  const enrollmentAction = path.match(/^\/api\/manage\/enrollment\/(\d+)\/(approve|renew|cancel)$/);
  if (enrollmentAction && method === 'POST') {
    guard(user, ['admin']);
    const enrollment = await getById(firestore, 'enrollments', id(enrollmentAction[1]));
    if (!enrollment) throw new HttpError(404, 'Enrollment not found');
    const action = enrollmentAction[2];
    if (action === 'cancel') {
      if (['cancelled', 'expired'].includes(enrollment.status)) {
        return sendJson(response, 200, { ok: true, status: enrollment.status });
      }
      await revokeDriveEnrollment(firestore, enrollment, user, 'cancelled');
      return sendJson(response, 200, { ok: true, status: 'cancelled' });
    }
    if (action === 'approve' && !['pending', 'active'].includes(enrollment.status)) {
      throw new HttpError(409, 'Only pending or existing active enrollments can be approved');
    }
    if (action === 'renew' && !['active', 'cancelled', 'expired'].includes(enrollment.status)) {
      throw new HttpError(409, 'Only active, cancelled, or expired enrollments can be renewed');
    }
    const result = await activateEnrollmentWithDrive(firestore, auth, enrollment, user, body, action);
    return sendJson(response, 200, { ok: true, ...result });
  }

  if (path === '/api/manage/course' && method === 'POST') {
    guard(user, ['admin', 'hr']);
    const slug = String(body.slug || '').trim().toLowerCase();
    const title = String(body.title || '').trim().slice(0, 180);
    const category = String(body.category || '').trim().slice(0, 100);
    if (!title || !category) throw new HttpError(400, 'Title and category are required');
    if (!/^[a-z0-9-]+$/.test(slug)) throw new HttpError(400, 'Invalid slug');
    if (await findOne(firestore, 'courses', 'slug', slug)) throw new HttpError(409, 'Slug already exists');
    const courseId = await create(firestore, 'courses', {
      slug,
      title,
      category,
      description: String(body.description || '').trim().slice(0, 1500),
      duration: String(body.duration || '').trim().slice(0, 80),
      price: Math.max(0, Number(body.price) || 0),
      level: 'Beginner to Advanced', icon: '◎', featured: 0, published: 1,
      instructor_id: null, created_at: now()
    });
    await recordAudit(firestore, user, 'create', 'course');
    return sendJson(response, 201, { id: courseId.id });
  }
  if (path === '/api/manage/service' && method === 'POST') {
    guard(user, ['admin', 'hr']);
    const serviceId = body.id ? id(body.id) : null;
    const title = String(body.title || '').trim().slice(0, 140);
    const slug = String(body.slug || '').trim().toLowerCase();
    const description = String(body.description || '').trim().slice(0, 1500);
    const published = body.published === undefined ? 1 : Number(body.published);
    if (!title || !description) throw new HttpError(400, 'Title and description are required');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(400, 'Invalid slug');
    if (![0, 1].includes(published)) throw new HttpError(400, 'Invalid publication status');
    const duplicate = await findOne(firestore, 'services', 'slug', slug);
    if (duplicate && Number(duplicate.id) !== serviceId) throw new HttpError(409, 'Slug already exists');
    if (serviceId) {
      await save(firestore, 'services', serviceId, { title, slug, description, published });
      await recordAudit(firestore, user, 'update', 'service');
      return sendJson(response, 200, { ok: true });
    }
    await create(firestore, 'services', { title, slug, description, published, created_at: now() });
    await recordAudit(firestore, user, 'create', 'service');
    return sendJson(response, 201, { ok: true });
  }
  const serviceDelete = path.match(/^\/api\/manage\/service\/(\d+)$/);
  if (serviceDelete && method === 'DELETE') {
    guard(user, ['admin', 'hr']);
    await remove(firestore, 'services', id(serviceDelete[1]));
    await recordAudit(firestore, user, 'delete', 'service');
    return sendJson(response, 200, { ok: true });
  }
  if (path === '/api/manage/blog' && method === 'POST') {
    guard(user, ['admin']);
    const postId = body.id ? id(body.id) : null;
    const title = String(body.title || '').trim().slice(0, 180);
    const slug = String(body.slug || '').trim().toLowerCase();
    const excerpt = String(body.excerpt || '').trim().slice(0, 500);
    const content = String(body.content || '').trim().slice(0, 20000);
    const status = String(body.status || '').trim();
    if (!title || !content) throw new HttpError(400, 'Title and content are required');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(400, 'Invalid slug');
    if (!['draft', 'published'].includes(status)) throw new HttpError(400, 'Invalid status');
    const duplicate = await findOne(firestore, 'blog_posts', 'slug', slug);
    if (duplicate && Number(duplicate.id) !== postId) throw new HttpError(409, 'Slug already exists');
    const existing = postId ? await getById(firestore, 'blog_posts', postId) : null;
    if (postId && !existing) throw new HttpError(404, 'Blog post not found');
    const publishedAt = status === 'published' ? (existing?.published_at || now()) : '';
    if (postId) {
      await save(firestore, 'blog_posts', postId, {
        title, slug, excerpt, content, status, updated_at: now(), published_at: publishedAt
      });
      await recordAudit(firestore, user, 'update', 'blog_post');
      return sendJson(response, 200, { ok: true });
    }
    const createdAt = now();
    await create(firestore, 'blog_posts', {
      title, slug, excerpt, content, status, created_at: createdAt, updated_at: createdAt, published_at: publishedAt
    });
    await recordAudit(firestore, user, 'create', 'blog_post');
    return sendJson(response, 201, { ok: true });
  }
  const blogDelete = path.match(/^\/api\/manage\/blog\/(\d+)$/);
  if (blogDelete && method === 'DELETE') {
    guard(user, ['admin']);
    await remove(firestore, 'blog_posts', id(blogDelete[1]));
    await recordAudit(firestore, user, 'delete', 'blog_post');
    return sendJson(response, 200, { ok: true });
  }
  if (path === '/api/manage/lesson' && method === 'POST') {
    guard(user, ['admin']);
    const courseId = id(body.course_id);
    const course = await getById(firestore, 'courses', courseId);
    if (!course) throw new HttpError(404, 'Course not found');
    if (body.video_url) throw new HttpError(400, 'Choose a video from the registered Google Drive course folder');
    const title = String(body.title || '').trim().slice(0, 180);
    const content = String(body.content || '').trim().slice(0, 12000);
    if (!title || !content) throw new HttpError(400, 'Title and content are required');
    let driveFile = null;
    const driveFileId = String(body.drive_file_id || '').trim();
    if (driveFileId) {
      const folderSnapshot = await firestore.collection('drive_course_folders').doc(String(courseId)).get();
      if (!folderSnapshot.exists) throw new HttpError(409, 'Register a Google Drive folder for this course first');
      driveFile = await validateCourseVideo(
        createDriveApi(), driveFileId, folderSnapshot.data().folder_id
      );
    }
    await create(firestore, 'lessons', {
      course_id: courseId, title, summary: '', content,
      drive_file_id: driveFile?.id || '',
      drive_file_name: driveFile?.name || '',
      sort_order: Number(body.sort_order) || 1, published: 1
    });
    await recordAudit(firestore, user, 'create', 'lesson', {
      course_id: courseId,
      drive_file_id: driveFile?.id || null
    });
    return sendJson(response, 201, { ok: true });
  }
  if (path === '/api/manage/student' && method === 'POST') {
    guard(user, ['admin', 'hr']);
    const email = emailAddress(body.email);
    const name = String(body.name || '').trim().slice(0, 100);
    const password = String(body.password || '');
    if (!name) throw new HttpError(400, 'Name is required');
    const userId = await createPortalUser(auth, firestore, { name, email, password, role: 'student' });
    await recordAudit(firestore, user, 'create', 'student');
    return sendJson(response, 201, { id: userId });
  }
  if (path === '/api/manage/enroll' && method === 'POST') {
    guard(user, ['admin', 'hr']);
    const userId = id(body.user_id);
    const courseId = id(body.course_id);
    const [student, course] = await Promise.all([
      getById(firestore, 'users', userId), getById(firestore, 'courses', courseId)
    ]);
    if (!student || student.role !== 'student') throw new HttpError(404, 'Student not found');
    if (!course) throw new HttpError(404, 'Course not found');
    const existing = (await query(firestore, 'enrollments', 'user_id', '==', userId))
      .find(item => Number(item.course_id) === courseId);
    if (existing) {
      if (existing.status === 'pending') {
        return sendJson(response, 200, { ok: true, id: existing.id, status: existing.status });
      }
      throw new HttpError(409, 'An enrollment already exists; use its approval, cancellation, or renewal workflow');
    }
    const enrollment = await create(firestore, 'enrollments', {
      user_id: userId,
      course_id: courseId,
      status: 'pending',
      drive_access_status: 'not_granted',
      created_at: now()
    });
    await recordAudit(firestore, user, 'request', 'enrollment', {
      enrollment_id: enrollment.id,
      student_id: userId,
      course_id: courseId,
      outcome: 'pending_admin_approval'
    });
    return sendJson(response, 201, { ok: true, id: enrollment.id, status: 'pending' });
  }
  if (path === '/api/manage/batch' && method === 'POST') {
    guard(user, ['admin', 'hr']);
    const courseId = id(body.course_id);
    if (!await getById(firestore, 'courses', courseId)) throw new HttpError(404, 'Course not found');
    const name = String(body.name || '').trim().slice(0, 140);
    const startsOn = String(body.starts_on || '').trim();
    const mode = String(body.mode || '');
    const seats = Number(body.seats);
    if (!name) throw new HttpError(400, 'Batch name is required');
    if (!validDateOnly(startsOn)) {
      throw new HttpError(400, 'Invalid start date');
    }
    if (!['On-site', 'Online', 'Hybrid'].includes(mode)) throw new HttpError(400, 'Invalid batch mode');
    if (!Number.isInteger(seats) || seats < 1 || seats > 500) throw new HttpError(400, 'Seats must be between 1 and 500');
    await create(firestore, 'batches', {
      course_id: courseId, name, starts_on: startsOn, mode,
      schedule: String(body.schedule || '').trim().slice(0, 120), seats
    });
    await recordAudit(firestore, user, 'create', 'batch');
    return sendJson(response, 201, { ok: true });
  }
  if (path === '/api/manage/job' && method === 'POST') {
    guard(user, ['hr', 'admin']);
    const title = String(body.title || '').trim().slice(0, 180);
    const department = String(body.department || '').trim().slice(0, 120);
    if (!title || !department) throw new HttpError(400, 'Title and department are required');
    await create(firestore, 'jobs', {
      title, department,
      location: String(body.location || '').trim().slice(0, 100) || 'On-site',
      type: String(body.type || '').trim().slice(0, 60) || 'Full-time',
      description: String(body.description || '').trim().slice(0, 2000),
      status: 'open', created_at: now()
    });
    await recordAudit(firestore, user, 'create', 'job');
    return sendJson(response, 201, { ok: true });
  }
  if (path === '/api/manage/employee' && method === 'POST') {
    guard(user, ['hr', 'admin']);
    const name = String(body.name || '').trim().slice(0, 100);
    const email = emailAddress(body.email);
    const department = String(body.department || '').trim().slice(0, 120);
    const designation = String(body.designation || '').trim().slice(0, 120);
    if (!name || !department || !designation) throw new HttpError(400, 'Name, department and designation are required');
    if ((await list(firestore, 'employees')).some(item => item.email.toLowerCase() === email)
      || await findOne(firestore, 'users', 'email', email)) {
      throw new HttpError(409, 'Email already belongs to an account or employee');
    }
    const userId = await createPortalUser(auth, firestore, {
      name, email, password: String(body.password || ''), role: 'employee',
      phone: String(body.phone || '').trim().slice(0, 30)
    });
    const userProfile = await getById(firestore, 'users', userId);
    let employee;
    try {
      employee = await create(firestore, 'employees', {
        name, email, department, designation,
        joined_at: String(body.joined_at || '').trim() || now().slice(0, 10), status: 'active'
      });
    } catch (error) {
      await auth.deleteUser(userProfile.auth_uid);
      await firestore.collection('users').doc(String(userId)).delete();
      throw error;
    }
    await recordAudit(firestore, user, 'create', 'employee');
    return sendJson(response, 201, { id: employee.id, user_id: userId });
  }
  if (path === '/api/manage/employee-account' && method === 'POST') {
    guard(user, ['hr', 'admin']);
    const employee = await getById(firestore, 'employees', id(body.employee_id));
    if (!employee || employee.status !== 'active') throw new HttpError(404, 'Active employee not found');
    if (await findOne(firestore, 'users', 'email', employee.email.toLowerCase())) {
      throw new HttpError(409, 'An account already uses this email');
    }
    const userId = await createPortalUser(auth, firestore, {
      name: employee.name, email: employee.email.toLowerCase(),
      password: String(body.password || ''), role: 'employee'
    });
    await recordAudit(firestore, user, 'create', 'employee_account');
    return sendJson(response, 201, { user_id: userId });
  }
  if (path === '/api/manage/task' && method === 'POST') {
    guard(user, ['admin']);
    const employeeId = id(body.employee_id);
    const employee = await getById(firestore, 'employees', employeeId);
    const employeeUser = employee ? await findOne(firestore, 'users', 'email', employee.email.toLowerCase()) : null;
    const title = String(body.title || '').trim().slice(0, 180);
    const dueDate = String(body.due_date || '').trim();
    const priority = String(body.priority || '');
    if (!employee || employee.status !== 'active' || !employeeUser
      || employeeUser.role !== 'employee' || !employeeUser.active) {
      throw new HttpError(404, 'Active employee with a login not found');
    }
    if (!title) throw new HttpError(400, 'Task title is required');
    if (!validDateOnly(dueDate)) {
      throw new HttpError(400, 'Invalid due date');
    }
    if (!['low', 'medium', 'high'].includes(priority)) throw new HttpError(400, 'Invalid task priority');
    const createdAt = now();
    const task = await create(firestore, 'tasks', {
      title, description: String(body.description || '').trim().slice(0, 2000),
      employee_id: employeeId, due_date: dueDate, priority, status: 'pending', progress: 0,
      created_by: user.id, created_at: createdAt, updated_at: createdAt
    });
    await recordAudit(firestore, user, 'create', 'task');
    return sendJson(response, 201, { id: task.id });
  }
  if (path === '/api/manage/announcement' && method === 'POST') {
    guard(user, ['admin']);
    const audience = String(body.audience || '').trim();
    if (!['all', 'student', 'hr', 'instructor'].includes(audience)) throw new HttpError(400, 'Invalid audience');
    const title = String(body.title || '').trim().slice(0, 180);
    const text = String(body.body || '').trim().slice(0, 2000);
    if (!title || !text) throw new HttpError(400, 'Title and body are required');
    await create(firestore, 'announcements', { title, body: text, audience, created_at: now() });
    await recordAudit(firestore, user, 'create', 'announcement');
    return sendJson(response, 201, { ok: true });
  }
  if (path === '/api/manage/leave' && method === 'POST') {
    guard(user, ['hr', 'admin']);
    const employeeId = id(body.employee_id);
    if (!await getById(firestore, 'employees', employeeId)) throw new HttpError(404, 'Employee not found');
    const from = String(body.from_date || '').trim();
    const to = String(body.to_date || '').trim();
    if (!validDateOnly(from) || !validDateOnly(to) || to < from) {
      throw new HttpError(400, 'Invalid leave dates');
    }
    const reason = String(body.reason || '').trim().slice(0, 500);
    if (!reason) throw new HttpError(400, 'Reason is required');
    await create(firestore, 'leave_requests', {
      employee_id: employeeId, from_date: from, to_date: to, reason,
      status: 'pending', created_at: now()
    });
    await recordAudit(firestore, user, 'create', 'leave_request');
    return sendJson(response, 201, { ok: true });
  }
  if (path === '/api/manage/update' && method === 'POST') {
    const settings = {
      leads: { roles: ['admin', 'hr'], values: ['new', 'contacted', 'qualified', 'closed'] },
      applications: { roles: ['admin', 'hr'], values: ['applied', 'screening', 'interview', 'offered', 'rejected'] },
      leave_requests: { roles: ['admin', 'hr'], values: ['pending', 'approved', 'rejected'] },
      tasks: { roles: ['admin'], values: ['pending', 'in_progress', 'completed'] },
      tickets: { roles: ['admin'], values: ['open', 'resolved'] }
    };
    const config = settings[body.table];
    if (!config) throw new HttpError(400, 'Unsupported resource');
    guard(user, config.roles);
    if (!config.values.includes(body.status)) throw new HttpError(400, 'Invalid status');
    const recordId = id(body.id);
    const current = await getById(firestore, body.table, recordId);
    if (!current) throw new HttpError(404, 'Record not found');
    const update = { status: body.status };
    if (body.table === 'tasks') {
      update.progress = body.status === 'completed' ? 100
        : body.status === 'pending' ? 0 : Math.min(Number(current.progress) || 0, 99);
      update.updated_at = now();
    }
    await save(firestore, body.table, recordId, update);
    await recordAudit(firestore, user, 'update', body.table);
    return sendJson(response, 200, { ok: true });
  }
  if (path === '/api/manage/grade' && method === 'POST') {
    guard(user, ['instructor', 'admin']);
    const submissionId = id(body.id);
    const submission = await getById(firestore, 'assignment_submissions', submissionId);
    if (!submission) throw new HttpError(404, 'Submission not found');
    const assignment = await getById(firestore, 'assignments', submission.assignment_id);
    const course = assignment ? await getById(firestore, 'courses', assignment.course_id) : null;
    if (!course || (user.role === 'instructor' && Number(course.instructor_id) !== user.id)) {
      throw new HttpError(403, 'Not your submission');
    }
    const grade = Number(body.grade);
    if (!Number.isInteger(grade) || grade < 0 || grade > 100) throw new HttpError(400, 'Grade 0-100 required');
    await save(firestore, 'assignment_submissions', submissionId, {
      grade, feedback: String(body.feedback || '').trim().slice(0, 1000), graded_at: now()
    });
    return sendJson(response, 200, { ok: true });
  }
  throw new HttpError(404, 'API endpoint not found');
}

module.exports = handler;
