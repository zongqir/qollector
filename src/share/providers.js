// Frontend-driven provider registry.
// To add a new free provider, just add an entry here — no backend changes needed.

export const FREE_PROVIDERS = {
  ZeroX0: {
    url: 'https://0x0.st',
    fileField: 'file',
    extraFields: {},
    parseResponse: (status, body) => {
      if (status === 429) throw new Error('rate_limited');
      const text = body.trim();
      if (text.startsWith('http')) return text;
      throw new Error(`Unexpected: ${text.slice(0, 200)}`);
    },
  },
  Tmpfiles: {
    url: 'https://tmpfiles.org/api/v1/upload',
    fileField: 'file',
    extraFields: {},
    parseResponse: (status, body) => {
      if (status === 429) throw new Error('rate_limited');
      const json = JSON.parse(body);
      const url = json?.data?.url;
      if (!url) throw new Error('Missing url in response');
      return url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    },
  },
  Catbox: {
    url: 'https://catbox.moe/user/api.php',
    fileField: 'fileToUpload',
    extraFields: { reqtype: 'fileupload' },
    parseResponse: (status, body) => {
      if (status === 429) throw new Error('rate_limited');
      const text = body.trim();
      if (text.startsWith('http')) return text;
      throw new Error(`Unexpected: ${text.slice(0, 200)}`);
    },
  },
  Litterbox: {
    url: 'https://litterbox.catbox.moe/resources/internals/api.php',
    fileField: 'fileToUpload',
    extraFields: { reqtype: 'fileupload', time: '72h' },
    parseResponse: (status, body) => {
      if (status === 429) throw new Error('rate_limited');
      const text = body.trim();
      if (text.startsWith('http')) return text;
      throw new Error(`Unexpected: ${text.slice(0, 200)}`);
    },
  },
};
