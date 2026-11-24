(() => {
  const form = document.getElementById('quotation-form');
  if (!form) return;

  const status = document.getElementById('form-status');
  const submitButton = form.querySelector('button[type="submit"]');
  const wordFields = [...form.querySelectorAll('[data-word-limit]')];

  const wordCount = (value) => {
    const text = value.trim();
    return text ? text.split(/\s+/).length : 0;
  };

  const updateWordCount = (field) => {
    const limit = Number(field.dataset.wordLimit);
    const count = wordCount(field.value);
    const counter = document.getElementById(`${field.id}-count`);
    const overLimit = count > limit;
    field.setCustomValidity(overLimit ? `Please keep this field within ${limit} words.` : '');
    counter.textContent = `${count}/${limit} words`;
    counter.classList.toggle('over-limit', overLimit);
  };

  wordFields.forEach((field) => {
    updateWordCount(field);
    field.addEventListener('input', () => updateWordCount(field));
  });

  const service = new URLSearchParams(window.location.search).get('service');
  const serviceSelect = form.elements.service;
  const selectService = () => {
    if (service && [...serviceSelect.options].some((option) => option.value === service)) {
      serviceSelect.value = service;
    }
  };
  selectService();
  fetch('/api/services')
    .then(async (response) => {
      if (!response.ok) throw new Error('Could not load available services.');
      const result = await response.json();
      if (!Array.isArray(result.items)) throw new Error('Invalid services response.');
      const existing = new Set([...serviceSelect.options].map((option) => option.value));
      result.items.forEach((item) => {
        if (existing.has(item.title)) return;
        const option = document.createElement('option');
        option.value = item.title;
        option.textContent = item.title;
        serviceSelect.append(option);
        existing.add(item.title);
      });
      selectService();
    })
    .catch((error) => console.error('Could not load additional quotation services.', error));

  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.getElementById('primary-nav');
  menuButton.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Open navigation menu' : 'Close navigation menu');
    menuButton.textContent = isOpen ? '☰' : '✕';
    navigation.classList.toggle('open', !isOpen);
  });
  navigation.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navigation.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Open navigation menu');
      menuButton.textContent = '☰';
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    status.className = 'form-status';

    for (const field of wordFields) updateWordCount(field);
    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    status.textContent = 'Sending your quotation request...';
    try {
      const response = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to submit your quotation request.');

      form.reset();
      wordFields.forEach(updateWordCount);
      status.textContent = 'Thank you. Your quotation request has been received.';
      status.classList.add('success');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Unable to submit your quotation request.';
      status.classList.add('error');
    } finally {
      submitButton.disabled = false;
    }
  });
})();
