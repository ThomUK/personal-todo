const API = 'https://api.github.com';

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64decode(str) {
  return decodeURIComponent(escape(atob(str.replace(/\n/g, ''))));
}

export async function loadBoard(token, owner, repo, branch, path) {
  const url = `${API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (res.status === 404) return { data: { version: 1, tasks: [] }, sha: null };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  const file = await res.json();
  return { data: JSON.parse(b64decode(file.content)), sha: file.sha };
}

export async function saveBoard(token, owner, repo, branch, path, data, sha, message) {
  const url = `${API}/repos/${owner}/${repo}/contents/${path}`;
  const body = {
    message,
    content: b64encode(JSON.stringify(data, null, 2)),
    branch,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  const result = await res.json();
  return result.content.sha;
}
