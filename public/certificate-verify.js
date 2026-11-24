(() => {
  const form = document.getElementById('certificate-form');
  if (!form) return;

  const input = document.getElementById('certificate-number');
  const result = document.getElementById('certificate-result');
  const button = form.querySelector('button');

  function showResult(state, title, message) {
    result.className = `certificate-result ${state}`;

    const card = document.createElement('div');
    card.className = 'certificate-result__card';

    const icon = document.createElement('span');
    icon.className = 'certificate-result__icon';
    icon.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', state === 'verified' ? 'm5 12 4 4L19 6' : 'M6 6 18 18M18 6 6 18');
    svg.append(path);
    icon.append(svg);

    const heading = document.createElement('h2');
    heading.textContent = title;
    const description = document.createElement('p');
    description.textContent = message;
    card.append(icon, heading, description);
    result.replaceChildren(card);
    return card;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const code = input.value.trim();
    if (!code) {
      input.reportValidity();
      return;
    }

    button.disabled = true;
    result.className = 'certificate-result';
    result.textContent = 'Checking certificate…';
    result.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(`/api/certificates/verify?code=${encodeURIComponent(code)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to verify certificate.');
      if (!data.valid) {
        showResult('invalid', 'Not Found', 'No certificate found with this ID. Please check and try again.');
        return;
      }

      const card = showResult('verified', 'Certificate Verified', 'This certificate is authentic and was issued by Hackademic.');
      const detailsCard = document.createElement('div');
      detailsCard.className = 'certificate-card';

      const details = document.createElement('dl');
      const values = [
        ['Certificate number', data.certificate.code],
        ['Student', data.certificate.name],
        ['Course', data.certificate.course],
        ['Issue date', new Date(data.certificate.issued_at).toLocaleDateString()]
      ];
      for (const [label, value] of values) {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = label;
        description.textContent = value;
        row.append(term, description);
        details.append(row);
      }
      detailsCard.append(details);
      card.append(detailsCard);
    } catch (error) {
      showResult('error', 'Unable to Verify', error.message);
    } finally {
      button.disabled = false;
      result.removeAttribute('aria-busy');
    }
  });

  const faqItems = [...document.querySelectorAll('.faq-item')];
  for (const item of faqItems) {
    const toggle = item.querySelector('.faq-toggle');
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    toggle.addEventListener('click', () => {
      const shouldOpen = toggle.getAttribute('aria-expanded') !== 'true';
      for (const other of faqItems) {
        const otherToggle = other.querySelector('.faq-toggle');
        const otherPanel = document.getElementById(otherToggle.getAttribute('aria-controls'));
        const isOpen = other === item && shouldOpen;
        other.classList.toggle('is-open', isOpen);
        otherToggle.setAttribute('aria-expanded', String(isOpen));
        otherPanel.setAttribute('aria-hidden', String(!isOpen));
        otherPanel.inert = !isOpen;
      }
    });
    panel.inert = !item.classList.contains('is-open');
  }
})();
