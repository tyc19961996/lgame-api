import assert from 'node:assert/strict';

const requests = [];
globalThis.window = {
  qg: {
    login(options) {
      options.success({ data: { token: 'oppo-token', uid: 'oppo-uid' } });
    },
  },
};

class FakeXMLHttpRequest {
  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  send() {
    requests.push({ method: this.method, url: this.url, body: this.body });
    this.status = 200;
    this.responseText = JSON.stringify({
      code: 0,
      message: 'Success',
      data: { open_id: 'oppo-user-id', token: 'jwt-token' },
      timestamp: '1760000000000',
    });
    this.readyState = 4;
    this.onreadystatechange();
  }
}

globalThis.XMLHttpRequest = FakeXMLHttpRequest;
const { LGameAPI } = await import('../dist/index.js');

LGameAPI.init({ baseUrl: 'https://example.test/api/v1/', appid: 'com.example.game' });
const response = await LGameAPI.login();

assert.equal(response.code, 0);
assert.equal(LGameAPI.openId, 'oppo-user-id');
assert.equal(LGameAPI.token, 'jwt-token');
assert.equal(requests.length, 1);
const requestUrl = new URL(requests[0].url);
assert.equal(requestUrl.searchParams.get('appid'), 'com.example.game');
assert.equal(requestUrl.searchParams.get('platform'), 'oppo');
assert.equal(requestUrl.searchParams.get('code'), 'oppo-token');

console.log('ok - qg.login maps the OPPO token to the existing login request');
