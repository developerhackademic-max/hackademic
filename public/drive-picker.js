let pickerScriptPromise;
let pickerLibraryPromise;

function loadScript(src) {
  if (!pickerScriptPromise) {
    pickerScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Google Drive Picker could not be loaded'));
      document.head.append(script);
    });
  }
  return pickerScriptPromise;
}

async function loadPickerLibrary() {
  if (!pickerLibraryPromise) {
    pickerLibraryPromise = (async () => {
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise(resolve => window.gapi.load('picker', { callback: resolve }));
    })();
  }
  return pickerLibraryPromise;
}

async function pickerSession() {
  const response = await fetch('/api/manage/drive-picker', { credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Drive Picker is unavailable');
  return result;
}

export async function chooseDriveItem({ folderId = '', foldersOnly = false } = {}) {
  const session = await pickerSession();
  await loadPickerLibrary();
  const picker = window.google.picker;
  const view = foldersOnly
    ? new picker.DocsView(picker.ViewId.FOLDERS).setSelectFolderEnabled(true)
    : new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(false)
      .setMimeTypes('video/mp4,video/webm,video/quicktime,video/x-m4v');
  if (folderId) view.setParent(folderId);

  return new Promise((resolve, reject) => {
    const builder = new picker.PickerBuilder()
      .setAppId(session.appId)
      .setDeveloperKey(session.apiKey)
      .setOAuthToken(session.accessToken)
      .addView(view)
      .setCallback(data => {
        if (data[picker.Response.ACTION] === picker.Action.CANCEL) {
          resolve(null);
          return;
        }
        if (data[picker.Response.ACTION] !== picker.Action.PICKED) return;
        const document = data[picker.Response.DOCUMENTS]?.[0];
        if (!document) {
          reject(new Error('Google Drive did not return a selected item'));
          return;
        }
        resolve({
          id: document[picker.Document.ID],
          name: document[picker.Document.NAME],
          mimeType: document[picker.Document.MIME_TYPE]
        });
      });
    if (foldersOnly) builder.enableFeature(picker.Feature.NAV_HIDDEN);
    builder.build().setVisible(true);
  });
}
