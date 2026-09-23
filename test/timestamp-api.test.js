import assert from 'node:assert/strict';
import { LGameAPI } from '../dist/index.js';

const requests = [];

class FakeXMLHttpRequest {
  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  send() {
    requests.push({ method: this.method, url: this.url });
    this.status = 200;
    this.responseText = JSON.stringify({
      code: 0,
      message: 'Success',
      data: null,
      timestamp: '1760000000000',
    });
    this.readyState = 4;
    this.onreadystatechange();
  }
}

globalThis.XMLHttpRequest = FakeXMLHttpRequest;
LGameAPI.init({ baseUrl: 'https://example.test/api/v1' });

const response = await LGameAPI.getTimestamp();

assert.equal(response.code, 0);
assert.equal(response.data, null);
assert.equal(response.timestamp, '1760000000000');
assert.deepEqual(requests, [{
  method: 'GET',
  url: 'https://example.test/api/v1/timestamp',
}]);

console.log('ok - getTimestamp sends a GET request to the configured service endpoint');
