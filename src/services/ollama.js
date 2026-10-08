/**
 * ollama.js — minimal client for a local Ollama server (http://127.0.0.1:11434).
 *
 * Uses Node's http module rather than the browser's fetch: the renderer has
 * Node integration, and going through Node means Ollama's CORS/origin rules
 * can never block the request, whatever OLLAMA_ORIGINS is set to.
 *
 * Streaming: /api/chat with stream:true returns one JSON object per line
 * (NDJSON). Text arrives in message.content pieces; tool calls arrive in
 * message.tool_calls; the last line has done:true.
 */

const http = require('http');

const DEFAULTS = { host: '127.0.0.1', port: 11434 };

/** Split a stream of bytes into complete lines, keeping the unfinished tail. */
function createLineSplitter(onLine) {
    let buf = '';
    return {
        push(chunk) {
            buf += chunk;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (line) onLine(line);
            }
        },
        end() {
            const line = buf.trim();
            buf = '';
            if (line) onLine(line);
        },
    };
}

function friendlyConnectionError(err, cfg) {
    if (err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'EHOSTUNREACH')) {
        const e = new Error(`Ollama isn't running (nothing answered on ${cfg.host}:${cfg.port}). Start Ollama and try again.`);
        e.code = 'OLLAMA_DOWN';
        return e;
    }
    return err;
}

function createClient(options = {}) {
    const cfg = { ...DEFAULTS, ...options };

    /**
     * Low-level request. If onLine is given the response is streamed line by
     * line; otherwise the whole body is returned.
     */
    function request(method, path, body, { onLine, signal, timeoutMs = 0 } = {}) {
        return new Promise((resolve, reject) => {
            if (signal && signal.aborted) return reject(abortError());

            const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
            const req = http.request({
                host: cfg.host, port: cfg.port, path, method,
                headers: payload
                    ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
                    : {},
            }, res => {
                res.setEncoding('utf8');
                const status = res.statusCode || 0;

                // Errors come back as a JSON body: {"error":"..."}
                if (status >= 400) {
                    let text = '';
                    res.on('data', c => { text += c; });
                    res.on('end', () => {
                        let msg = text;
                        try { msg = JSON.parse(text).error || text; } catch { /* plain text */ }
                        const e = new Error(msg || `Ollama returned HTTP ${status}`);
                        e.status = status;
                        reject(e);
                    });
                    return;
                }

                if (onLine) {
                    const split = createLineSplitter(line => {
                        try { onLine(JSON.parse(line)); }
                        catch (err) { /* ignore a malformed line rather than killing the stream */ }
                    });
                    res.on('data', c => split.push(c));
                    res.on('end', () => { split.end(); resolve(); });
                } else {
                    let text = '';
                    res.on('data', c => { text += c; });
                    res.on('end', () => {
                        try { resolve(text ? JSON.parse(text) : null); }
                        catch (err) { reject(new Error('Ollama sent an unreadable response.')); }
                    });
                }
                res.on('error', err => reject(signal && signal.aborted ? abortError() : err));
                // Destroyed mid-stream (Stop pressed): 'end' never fires, 'close' does
                res.on('close', () => { if (signal && signal.aborted) reject(abortError()); });
            });

            req.on('error', err => reject(signal && signal.aborted ? abortError() : friendlyConnectionError(err, cfg)));
            if (timeoutMs) {
                req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('Ollama did not respond in time.'), { code: 'ETIMEDOUT' })));
            }
            if (signal) signal.addEventListener('abort', () => req.destroy(abortError()), { once: true });

            if (payload) req.write(payload);
            req.end();
        });
    }

    /** Installed models: [{ name, sizeBytes, cloud }] */
    async function listModels({ signal } = {}) {
        const data = await request('GET', '/api/tags', undefined, { signal, timeoutMs: 4000 });
        return ((data && data.models) || []).map(m => ({
            name: m.name || m.model,
            sizeBytes: m.size || 0,
            // Cloud models run on Ollama's servers: name ends with -cloud/:cloud
            // and they have no local weights.
            cloud: /(^|[-:])cloud$/i.test(m.name || '') || !!m.remote_host || !!m.remote_model,
        }));
    }

    /**
     * One chat completion, streamed. Resolves with the assembled assistant
     * message: { content, thinking, tool_calls }.
     */
    async function chat({ model, messages, tools, think, options: modelOptions, onDelta, onThinking, signal }) {
        const body = { model, messages, stream: true };
        if (tools && tools.length) body.tools = tools;
        if (think !== undefined) body.think = think;
        if (modelOptions) body.options = modelOptions;

        const out = { content: '', thinking: '', tool_calls: [] };
        let streamError = null;

        await request('POST', '/api/chat', body, {
            signal,
            onLine: obj => {
                if (obj.error) { streamError = new Error(obj.error); return; }
                const msg = obj.message || {};
                if (msg.thinking) {
                    out.thinking += msg.thinking;
                    if (onThinking) onThinking(msg.thinking);
                }
                if (msg.content) {
                    out.content += msg.content;
                    if (onDelta) onDelta(msg.content);
                }
                if (Array.isArray(msg.tool_calls)) out.tool_calls.push(...msg.tool_calls);
            },
        });

        if (streamError) throw streamError;
        return out;
    }

    return { listModels, chat, config: cfg };
}

function abortError() {
    const e = new Error('Stopped');
    e.name = 'AbortError';
    return e;
}

module.exports = { createClient, createLineSplitter, DEFAULTS };
