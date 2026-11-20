import assert from 'node:assert/strict';

// Loaded only into the disposable smoke test's Next.js server.
const accounts = JSON.parse(process.env.DISCORD_SMOKE_ACCOUNTS);
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  if (input === 'https://discord.com/api/v10/oauth2/token') {
    assert.equal(init.method, 'POST');
    assert.equal(init.body.get('redirect_uri'), process.env.NEXT_PUBLIC_APP_URL + '/api/auth/discord/callback');
    const code = init.body.get('code');
    if (!Object.hasOwn(accounts, code)) return new Response(null, { status: 400 });
    return Response.json({ access_token: code });
  }

  if (input === 'https://discord.com/api/v10/users/@me') {
    const code = new Headers(init.headers).get('Authorization')?.replace(/^Bearer /, '');
    if (!Object.hasOwn(accounts, code)) return new Response(null, { status: 401 });
    return Response.json({ id: accounts[code], username: code, avatar: null, discriminator: '0' });
  }

  return realFetch(input, init);
};
