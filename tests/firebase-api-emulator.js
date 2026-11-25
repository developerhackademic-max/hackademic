'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { migrate } = require('../scripts/migrate-to-firebase');

process.env.FIREBASE_WEB_API_KEY ||= 'fake-api-key';
process.env.FIREBASE_AUTH_DOMAIN ||= 'demo-hackademic-local.firebaseapp.com';
process.env.FIREBASE_WEB_APP_ID ||= '1:000000000000:web:0000000000000000000000';
process.env.PUBLIC_APP_ORIGIN ||= 'http://127.0.0.1:3000';

const projectId = process.env.FIREBASE_PROJECT_ID;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const sourceFile = process.env.MIGRATION_SOURCE_FILE
  || path.join(__dirname, '..', 'data', 'hackademic-before-firebase-20261124.db');

test('Firebase-backed website APIs work with Auth and Firestore emulators', {
  skip: !projectId || !projectId.startsWith('demo-') || !authHost || !process.env.FIRESTORE_EMULATOR_HOST
    ? 'Set the two Firebase emulator hosts and a demo-* project ID.'
    : false
}, async () => {
  const { cert, getApps, initializeApp } = require('firebase-admin/app');
  if (!getApps().some(app => app.options.projectId === projectId)) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const serviceAccount = {
      project_id: projectId,
      client_email: `test-admin@${projectId}.iam.gserviceaccount.com`,
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
    };
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(serviceAccount);
    initializeApp({ projectId, credential: cert(serviceAccount) });
  }
  const auth = getAuth();
  const firestore = getFirestore();
  const report = await migrate({ sourceFile });
  assert.equal(report.projectId, projectId);

  const sqlite = new DatabaseSync(sourceFile, { readOnly: true });
  const users = sqlite.prepare('SELECT id,email,role FROM users ORDER BY id').all();
  const courses = sqlite.prepare('SELECT id FROM courses ORDER BY id').all();
  sqlite.close();
  const runId = Date.now().toString();
  assert.ok(users.some(user => user.role === 'admin'));
  assert.ok(users.some(user => user.role === 'hr'));
  assert.ok(users.some(user => user.role === 'student'));
  assert.ok(courses.length > 0);

  const server = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const driveEnvNames = [
    'GOOGLE_DRIVE_OWNER_EMAIL', 'GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_REFRESH_TOKEN', 'GOOGLE_PICKER_API_KEY', 'GOOGLE_CLOUD_PROJECT_NUMBER'
  ];
  const priorDriveEnv = Object.fromEntries(driveEnvNames.map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries({
    GOOGLE_DRIVE_OWNER_EMAIL: 'drive-owner@example.test',
    GOOGLE_DRIVE_CLIENT_ID: 'emulator-client-id',
    GOOGLE_DRIVE_CLIENT_SECRET: 'emulator-client-secret',
    GOOGLE_DRIVE_REFRESH_TOKEN: 'emulator-refresh-token',
    GOOGLE_PICKER_API_KEY: 'emulator-picker-key',
    GOOGLE_CLOUD_PROJECT_NUMBER: '123456789'
  })) process.env[name] = value;
  const originalFetch = global.fetch;
  const originalAuthGetUser = auth.getUser;
  const folderId = 'mock-course-folder-123';
  const videoId = 'mock-video-file-123';
  global.fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === 'oauth2.googleapis.com') {
      return new Response(JSON.stringify({
        access_token: 'mock-short-lived-token',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.file'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/drive/v3/')) {
      const remainder = decodeURIComponent(url.pathname.slice('/drive/v3/files/'.length));
      const [fileId, action, permissionId] = remainder.split('/');
      if (action === 'permissions' && options.method === 'POST') {
        return new Response(JSON.stringify({ id: 'mock-permission', type: 'user', role: 'reader' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (action === 'permissions') {
        return new Response(JSON.stringify({ permissions: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (fileId === folderId) {
        return new Response(JSON.stringify({
          id: folderId,
          name: 'Course videos',
          mimeType: 'application/vnd.google-apps.folder',
          owners: [{ emailAddress: 'drive-owner@example.test' }],
          webViewLink: `https://drive.google.com/drive/folders/${folderId}`
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (fileId === videoId) {
        return new Response(JSON.stringify({
          id: videoId,
          name: 'Lesson.mp4',
          mimeType: 'video/mp4',
          parents: [folderId],
          owners: [{ emailAddress: 'drive-owner@example.test' }],
          webViewLink: `https://drive.google.com/file/d/${videoId}/view`
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (permissionId) {
        return new Response(JSON.stringify({ error: { code: 404 } }), {
          status: 404, headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    return originalFetch(input, options);
  };
  const json = async (url, options = {}) => {
    const response = await fetch(base + url, options);
    const data = await response.json();
    return { response, data };
  };
  const postBody = data => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const emulator = `http://${authHost}`;
  const identityPost = async (action, data) => {
    const response = await fetch(
      `${emulator}/identitytoolkit.googleapis.com/v1/${action}?key=fake-api-key`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
    );
    const result = await response.json();
    assert.equal(response.ok, true, `${action}: ${result.error?.message || response.status}`);
    return result;
  };
  const login = async (email, password) => {
    const result = await json('/api/auth/login', postBody({ email, password }));
    assert.equal(result.response.status, 200);
    const cookies = result.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(cookies.includes('ha_session='));
    assert.ok(cookies.includes('ha_csrf='));
    return {
      user: result.data.user,
      csrf: result.data.csrf,
      headers: { cookie: cookies, 'Content-Type': 'application/json', 'X-CSRF-Token': result.data.csrf }
    };
  };
  const send = (headers, data) => ({
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });

  try {
    assert.equal((await json('/api/health')).response.status, 200);
    const resetPasswords = new Map();
    for (const user of users) {
      const request = await json('/api/auth/reset/request', postBody({ email: user.email }));
      assert.equal(request.response.status, 200);
      const currentCodes = await (await fetch(`${emulator}/emulator/v1/projects/${projectId}/oobCodes`)).json();
      const reset = currentCodes.oobCodes.filter(item =>
        item.email?.toLowerCase() === user.email.toLowerCase() && item.requestType === 'PASSWORD_RESET'
      ).pop();
      assert.ok(reset?.oobCode);
      const password = `${crypto.randomBytes(20).toString('base64url')}Aa1!`;
      const confirmation = await json('/api/auth/reset/confirm', postBody({
        oobCode: reset.oobCode, newPassword: password
      }));
      assert.equal(confirmation.response.status, 200, JSON.stringify(confirmation.data));
      resetPasswords.set(user.role, password);
    }

    const signedIn = {};
    for (const user of users) {
      signedIn[user.role] = await login(user.email, resetPasswords.get(user.role));
      assert.equal(signedIn[user.role].user.role, user.role);
      assert.equal(signedIn[user.role].user.id, Number(user.id));
    }
    const clientCredential = await identityPost('accounts:signInWithPassword', {
      email: users.find(user => user.role === 'student').email,
      password: resetPasswords.get('student'),
      returnSecureToken: true
    });
    const clientSession = await json('/api/auth/session', postBody({ idToken: clientCredential.idToken }));
    assert.equal(clientSession.response.status, 200);
    assert.equal(clientSession.data.user.role, 'student');
    assert.equal((await json('/api/auth/config')).response.status, 200);
    const admin = signedIn.admin;
    const manager = signedIn.hr;
    const student = signedIn.student;
    const unauthorized = await json('/api/manage/users', { headers: student.headers });
    assert.equal(unauthorized.response.status, 403);

    const lead = await json('/api/leads', postBody({
      name: 'Emulator enquiry', email: `emulator-lead-${runId}@example.test`,
      interest: 'Training', message: 'Firestore persistence test'
    }));
    assert.equal(lead.response.status, 201);
    const savedLead = await firestore.collection('leads').where('email', '==', `emulator-lead-${runId}@example.test`).get();
    assert.equal(savedLead.size, 1);
    const leadList = await json('/api/manage/leads', { headers: manager.headers });
    assert.ok(leadList.data.items.some(item => item.email === `emulator-lead-${runId}@example.test`));

    const quotation = await json('/api/quotations', postBody({
      companyName: 'Emulator Co', name: 'Test Contact', designation: 'Director',
      email: `quotation-${runId}@example.test`, phone: '6396111576',
      service: 'Security Audit & Assessment', projectDescription: 'Request a security assessment.'
    }));
    assert.equal(quotation.response.status, 201);

    const newCourse = await json('/api/manage/course', send(admin.headers, {
      title: 'Emulator Workflow Course',
      slug: `emulator-course-${Date.now()}`,
      category: 'Testing',
      duration: '2 weeks',
      price: 100
    }));
    assert.equal(newCourse.response.status, 201);
    const registeredFolder = await json('/api/manage/course-drive-folder', send(admin.headers, {
      course_id: Number(courses[0].id), folder_id: folderId
    }));
    assert.equal(registeredFolder.response.status, 200, JSON.stringify(registeredFolder.data));
    const deniedFolderRegistration = await json('/api/manage/course-drive-folder', send(manager.headers, {
      course_id: Number(courses[0].id), folder_id: folderId
    }));
    assert.equal(deniedFolderRegistration.response.status, 403);
    const pickerSession = await json('/api/manage/drive-picker', { headers: admin.headers });
    assert.equal(pickerSession.response.status, 200);
    assert.equal(pickerSession.data.accessToken, 'mock-short-lived-token');
    assert.equal('refreshToken' in pickerSession.data, false);
    const service = await json('/api/manage/service', send(manager.headers, {
      title: 'Emulator Service', slug: `emulator-service-${Date.now()}`,
      description: 'Created through the manager API.', published: 1
    }));
    assert.equal(service.response.status, 201);
    const services = await json('/api/services');
    assert.ok(services.data.items.some(item => item.title === 'Emulator Service'));

    const studentEmail = `new-student-${Date.now()}@example.test`;
    const createdStudent = await json('/api/manage/student', send(manager.headers, {
      name: 'New Emulator Student', email: studentEmail, password: 'StudentPassword!2026'
    }));
    assert.equal(createdStudent.response.status, 201);
    const enrolled = await json('/api/manage/enroll', send(manager.headers, {
      user_id: createdStudent.data.id, course_id: Number(courses[0].id)
    }));
    assert.equal(enrolled.response.status, 201);
    assert.equal(enrolled.data.status, 'pending');
    const managerApproval = await json(`/api/manage/enrollment/${enrolled.data.id}/approve`, send(manager.headers, {
      expiry_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
    }));
    assert.equal(managerApproval.response.status, 403);
    const rejectedApproval = await json(`/api/manage/enrollment/${enrolled.data.id}/approve`, send(admin.headers, {
      expiry_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
    }));
    assert.equal(rejectedApproval.response.status, 403);
    assert.equal((await firestore.collection('drive_permissions').doc(String(enrolled.data.id)).get()).exists, false);
    const newStudent = await login(studentEmail, 'StudentPassword!2026');
    const linkStatus = await json('/api/auth/google-link-status', { headers: newStudent.headers });
    assert.equal(linkStatus.response.status, 200);
    assert.equal(linkStatus.data.emailVerified, false);
    const newStudentCredential = await identityPost('accounts:signInWithPassword', {
      email: studentEmail, password: 'StudentPassword!2026', returnSecureToken: true
    });
    const rejectedLink = await json('/api/auth/link-google', send(newStudent.headers, {
      idToken: newStudentCredential.idToken
    }));
    assert.equal(rejectedLink.response.status, 403);
    const myCourses = await json('/api/my/courses', { headers: newStudent.headers });
    assert.equal(myCourses.response.status, 403);
    const deniedCourse = await json(`/api/my/courses/${courses[0].id}`, { headers: newStudent.headers });
    assert.equal(deniedCourse.response.status, 403);

    const recordingPolicy = await json('/api/manage/recording-upload', send(admin.headers, {
      extension: 'mp4', contentType: 'video/mp4', size: 12
    }));
    assert.equal(recordingPolicy.response.status, 404);
    const lesson = await json('/api/manage/lesson', send(admin.headers, {
      course_id: Number(courses[0].id), title: 'Emulator lesson', content: 'Test lesson',
      drive_file_id: videoId, sort_order: 99
    }));
    assert.equal(lesson.response.status, 201, JSON.stringify(lesson.data));
    const savedLesson = (await firestore.collection('lessons').where('course_id', '==', Number(courses[0].id))
      .where('title', '==', 'Emulator lesson').get()).docs[0].data();
    assert.equal(savedLesson.drive_file_id, videoId);

    const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
    await firestore.collection('enrollments').doc(String(enrolled.data.id)).set({
      status: 'active', drive_access_status: 'granted', expires_at: expiresAt
    }, { merge: true });
    await firestore.collection('drive_permissions').doc(String(enrolled.data.id)).set({
      enrollment_id: enrolled.data.id,
      course_id: Number(courses[0].id),
      student_id: createdStudent.data.id,
      email: studentEmail,
      folder_id: 'mock-course-folder',
      permission_id: 'mock-viewer-permission',
      expires_at: expiresAt,
      status: 'granted'
    });

    const unlinkedCourse = await json(`/api/my/courses/${courses[0].id}`, { headers: newStudent.headers });
    assert.equal(unlinkedCourse.response.status, 403);
    const originalGetUser = auth.getUser.bind(auth);
    const createdStudentProfile = (await firestore.collection('users')
      .doc(String(createdStudent.data.id)).get()).data();
    auth.getUser = async uid => {
      if (uid === createdStudentProfile.auth_uid) {
        return {
          email: studentEmail,
          emailVerified: true,
          providerData: [{ providerId: 'google.com', email: studentEmail }]
        };
      }
      return originalGetUser(uid);
    };
    const courseDetail = await json(`/api/my/courses/${courses[0].id}`, { headers: newStudent.headers });
    assert.equal(courseDetail.response.status, 200);
    if (courseDetail.data.lessons.length) {
      const progress = await json('/api/progress', send(newStudent.headers, {
        lesson_id: courseDetail.data.lessons[0].id
      }));
      assert.equal(progress.response.status, 200);
    }
    if (courseDetail.data.assessments.length) {
      const assessmentId = courseDetail.data.assessments[0].id;
      const assessment = await json(`/api/assessments/${assessmentId}`, { headers: newStudent.headers });
      assert.equal(assessment.response.status, 200);
      const attempt = await json('/api/attempts', send(newStudent.headers, {
        assessment_id: assessmentId,
        answers: assessment.data.questions.map(() => 0)
      }));
      assert.equal(attempt.response.status, 201);
    }
    if (courseDetail.data.assignments.length) {
      const submitted = await json('/api/submissions', send(newStudent.headers, {
        assignment_id: courseDetail.data.assignments[0].id,
        content: 'Emulator assignment submission'
      }));
      assert.equal(submitted.response.status, 200);
    }

    const job = await json('/api/manage/job', send(manager.headers, {
      title: 'Emulator Test Role', department: 'Engineering', location: 'Remote',
      type: 'Full-time', description: 'Test job post'
    }));
    assert.equal(job.response.status, 201);
    const jobListing = await json('/api/jobs');
    const postedJob = jobListing.data.items.find(item => item.title === 'Emulator Test Role');
    assert.ok(postedJob);
    const application = await json('/api/applications', postBody({
      job_id: postedJob.id, name: 'Applicant', email: `applicant-${runId}@example.test`,
      phone: '6396111576', resume_url: 'https://example.test/resume'
    }));
    assert.equal(application.response.status, 201);
    const applications = await json('/api/manage/applications', { headers: manager.headers });
    assert.ok(applications.data.items.some(item => item.email === `applicant-${runId}@example.test`));

    const employeeEmail = `new-employee-${Date.now()}@example.test`;
    const employeeCreated = await json('/api/manage/employee', send(manager.headers, {
      name: 'Emulator Employee', email: employeeEmail,
      department: 'Operations', designation: 'Coordinator',
      joined_at: '2026-01-10', password: 'EmployeePassword!2026'
    }));
    assert.equal(employeeCreated.response.status, 201);
    const employeeAccount = await login(employeeEmail, 'EmployeePassword!2026');
    const deniedTaskList = await json('/api/manage/tasks', { headers: manager.headers });
    assert.equal(deniedTaskList.response.status, 403);
    const task = await json('/api/manage/task', send(admin.headers, {
      employee_id: employeeCreated.data.id, title: 'Emulator task',
      due_date: '2027-01-10', priority: 'high'
    }));
    assert.equal(task.response.status, 201);
    const myTasks = await json('/api/my/tasks', { headers: employeeAccount.headers });
    assert.equal(myTasks.data.items.length, 1);
    const taskUpdate = await json('/api/my/task', send(employeeAccount.headers, {
      id: task.data.id, status: 'completed', progress: 100
    }));
    assert.equal(taskUpdate.response.status, 200);
    assert.equal(taskUpdate.data.status, 'completed');
    assert.equal((await firestore.collection('tasks').doc(String(task.data.id)).get()).data().progress, 100);

    const seo = await json('/api/manage/seo', { headers: admin.headers });
    assert.equal(seo.response.status, 200);
    assert.ok(seo.data.pages.some(page => page.page === 'about.html'));
    const seoUpdate = await json('/api/manage/seo/page', send(admin.headers, {
      page: 'about.html',
      title: 'Emulator SEO title',
      description: 'Metadata saved in Firestore.',
      canonical: 'https://www.hackademic.in/about.html',
      robots: 'noindex,follow',
      og_title: 'Emulator social title',
      og_description: 'Social metadata saved in Firestore.',
      og_image: '/assets/hackademic-mark.png',
      include_sitemap: 0,
      changefreq: 'monthly',
      priority: 0.6
    }));
    assert.equal(seoUpdate.response.status, 200);
    const renderedPage = await fetch(base + '/api/page?path=about.html');
    assert.equal(renderedPage.status, 200);
    assert.match(await renderedPage.text(), /<title>Emulator SEO title<\/title>/);
    const sitemap = await fetch(base + '/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.doesNotMatch(await sitemap.text(), /https:\/\/www\.hackademic\.in\/about\.html/);
    const robotsText = 'User-agent: *\nDisallow: /internal/\n\nSitemap: https://www.hackademic.in/sitemap.xml';
    const robotsUpdate = await json('/api/manage/seo/robots', send(admin.headers, { content: robotsText }));
    assert.equal(robotsUpdate.response.status, 200);
    assert.equal(await (await fetch(base + '/robots.txt')).text(), robotsText);

    const authMe = await json('/api/auth/me', { headers: student.headers });
    assert.equal(authMe.data.user.role, 'student');
    const logout = await json('/api/auth/logout', send(student.headers, {}));
    assert.equal(logout.response.status, 200);
  } finally {
    global.fetch = originalFetch;
    auth.getUser = originalAuthGetUser;
    for (const name of driveEnvNames) {
      if (priorDriveEnv[name] === undefined) delete process.env[name];
      else process.env[name] = priorDriveEnv[name];
    }
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
