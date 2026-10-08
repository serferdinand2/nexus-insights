const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { createClient, createLineSplitter } = require(path.join(__dirname, '..', 'src', 'services', 'ollama.js'));

/** A tiny fake Ollama. `handler(req, body, res)` decides what to send. */
function fakeOllama(handler) {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', c => { body += c; });
            req.on('end', () => handler(req, body ? JSON.parse(body) : null, res));
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}
const portOf = s => s.address().port;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('line splitter handles lines split across chunks', () => {
    const lines = [];
    const s = createLineSplitter(l => lines.push(l));
    s.push('{"a":1}\n{"b"'); s.push(':2}\n\n{"c":'); s.push('3}'); s.end();
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('lists models and flags cloud ones', async () => {
    const server = await fakeOllama((req, body, res) => {
        res.end(JSON.stringify({ models: [
            { name: 'qwen3:8b', size: 5200000000 },
            { name: 'gpt-oss:120b-cloud', size: 0 },
            { name: 'deepseek-v4-flash:cloud' },
        ] }));
    });
    try {
        const models = await createClient({ port: portOf(server) }).listModels();
        assert.deepEqual(models.map(m => [m.name, m.cloud]),
            [['qwen3:8b', false], ['gpt-oss:120b-cloud', true], ['deepseek-v4-flash:cloud', true]]);
    } finally { server.close(); }
});

test('streams text and collects tool calls, even when JSON lines are split mid-object', async () => {
    let received;
    const server = await fakeOllama(async (req, body, res) => {
        received = body;
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        const lines = [
            { message: { role: 'assistant', content: 'Your ' } },
            { message: { role: 'assistant', content: 'win rate' } },
            { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_overview', arguments: { queue: 'solo' } } }] } },
            { done: true },
        ].map(o => JSON.stringify(o) + '\n').join('');
        // dribble it out in awkward pieces
        for (let i = 0; i < lines.length; i += 7) { res.write(lines.slice(i, i + 7)); await sleep(1); }
        res.end();
    });
    try {
        const deltas = [];
        const out = await createClient({ port: portOf(server) }).chat({
            model: 'qwen3:8b',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [{ type: 'function', function: { name: 'get_overview' } }],
            think: false,
            options: { num_ctx: 8192 },
            onDelta: t => deltas.push(t),
        });
        assert.equal(out.content, 'Your win rate');
        assert.deepEqual(deltas, ['Your ', 'win rate']);
        assert.equal(out.tool_calls.length, 1);
        assert.equal(out.tool_calls[0].function.name, 'get_overview');
        // request shape Ollama expects
        assert.equal(received.stream, true);
        assert.equal(received.think, false);
        assert.equal(received.options.num_ctx, 8192);
        assert.equal(received.tools.length, 1);
    } finally { server.close(); }
});

test('an HTTP error (e.g. model not installed) becomes a readable message', async () => {
    const server = await fakeOllama((req, body, res) => {
        res.writeHead(404); res.end(JSON.stringify({ error: "model 'qwen3:8b' not found" }));
    });
    try {
        await assert.rejects(
            createClient({ port: portOf(server) }).chat({ model: 'qwen3:8b', messages: [] }),
            /not found/);
    } finally { server.close(); }
});

test('an error line inside the stream rejects', async () => {
    const server = await fakeOllama((req, body, res) => {
        res.write(JSON.stringify({ message: { content: 'partial' } }) + '\n');
        res.end(JSON.stringify({ error: 'out of memory' }) + '\n');
    });
    try {
        await assert.rejects(createClient({ port: portOf(server) }).chat({ model: 'x', messages: [] }), /out of memory/);
    } finally { server.close(); }
});

test('Ollama not running gives a clear "start Ollama" error', async () => {
    const server = await fakeOllama(() => {});
    const port = portOf(server);
    await new Promise(r => server.close(r));          // nothing listening on that port now
    await assert.rejects(createClient({ port }).listModels(), err => {
        assert.equal(err.code, 'OLLAMA_DOWN');
        assert.match(err.message, /Start Ollama/);
        return true;
    });
});

test('Stop (abort) ends a stream that is still running', async () => {
    const server = await fakeOllama((req, body, res) => {
        res.writeHead(200);
        res.write(JSON.stringify({ message: { content: 'thinking about it' } }) + '\n');
        // never ends on its own
    });
    try {
        const ac = new AbortController();
        const p = createClient({ port: portOf(server) }).chat({
            model: 'x', messages: [], signal: ac.signal,
            onDelta: () => ac.abort(),
        });
        await assert.rejects(p, err => err.name === 'AbortError');
    } finally { server.closeAllConnections && server.closeAllConnections(); server.close(); }
});
