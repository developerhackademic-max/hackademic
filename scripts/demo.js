const { demoSeed, one, run, now } = require('../db');

demoSeed();

const code = 'HA-2026-001';
const student = one('SELECT id FROM users WHERE email = ?', 'student@hackademic.demo');
const course = one('SELECT id FROM courses WHERE slug = ?', 'ethical-hacking-cyber-security');

if (!student || !course) {
  throw new Error('Unable to create the demo certificate: demo student or course is missing.');
}

if (!one('SELECT id FROM certificates WHERE code = ?', code) &&
    !one('SELECT id FROM certificates WHERE user_id = ? AND course_id = ?', student.id, course.id)) {
  run('INSERT INTO certificates(user_id,course_id,code,issued_at) VALUES(?,?,?,?)', student.id, course.id, code, now());
}

if (!one('SELECT id FROM certificates WHERE code = ?', code)) {
  throw new Error(`Unable to create demo certificate ${code}.`);
}

console.log(`Demo certificate ID: ${code}`);
