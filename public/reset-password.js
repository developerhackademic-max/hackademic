'use strict';

const form = document.querySelector('#resetForm');
const status = document.querySelector('#resetStatus');
const query = new URLSearchParams(location.search);
const oobCode = query.get('oobCode');

if (query.get('mode') === 'resetPassword' && oobCode) {
  form.hidden = false;
} else {
  status.textContent = 'This reset link is invalid or incomplete. Request a new password reset from the sign-in page.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(form);
  const password = String(data.get('password') || '');
  if (password !== data.get('confirmPassword')) {
    status.textContent = 'The passwords do not match.';
    return;
  }
  try {
    const response = await fetch('/api/auth/reset/confirm', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oobCode, newPassword: password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update password');
    status.textContent = result.message;
    form.hidden = true;
  } catch (error) {
    status.textContent = error.message;
  }
});
