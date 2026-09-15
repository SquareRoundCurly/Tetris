import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const types = { '.js':'text/javascript', '.json':'application/json', '.html':'text/html', '.css':'text/css' }
createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (!/^\/(?:tests\/host\.html|\.runtime\/|pocketrealms\.json|game\.json|scene\/|scripts\/)/.test(name)) throw new Error('Not found')
    const filename = path.resolve(root, '.' + name)
    if (!filename.startsWith(root + path.sep)) throw new Error('Not found')
    const data = await readFile(filename)
    response.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' })
    response.end(data)
  } catch { response.writeHead(404); response.end('Not found') }
}).listen(4193, '127.0.0.1')
