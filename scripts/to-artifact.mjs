// Convierte el build de un solo archivo (dist-artifact/index.html) al formato de página
// publicable: sin <!doctype>, <html>, <head> ni <body> propios (los añade la plataforma).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('dist-artifact/index.html', 'utf8');
const pick = (re) => [...src.matchAll(re)].map((m) => m[0]).join('\n');

const head = src.slice(src.indexOf('<head>') + 6, src.indexOf('</head>'));
const headKeep = pick(/<title>[\s\S]*?<\/title>|<meta name="claude:[^>]*>|<link[^>]*fonts[^>]*>|<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = [...head.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
const body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>')).trim();

writeFileSync('dist-artifact/maestro-port-lab.html', `${headKeep}\n${body}\n${scripts.join('\n')}\n`);
console.log('dist-artifact/maestro-port-lab.html listo');
