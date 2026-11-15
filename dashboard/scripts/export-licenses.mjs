import fs from 'node:fs'
import path from 'node:path'
const lock = JSON.parse(fs.readFileSync('package-lock.json'))
const notices = []
for (const [key, info] of Object.entries(lock.packages)) {
  if (!key || info.dev || !fs.existsSync(path.join(key, 'package.json'))) continue
  const pkg = JSON.parse(fs.readFileSync(path.join(key, 'package.json')))
  const files = fs.readdirSync(key).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name) && fs.statSync(path.join(key,name)).isFile())
  notices.push([pkg.name+' '+pkg.version, 'License: '+(pkg.license ?? info.license ?? 'See package license'), ...files.map(name => name+'\n'+fs.readFileSync(path.join(key,name),'utf8'))].join('\n\n'))
}
fs.writeFileSync('public/legal/THIRD-PARTY-NOTICES.txt', 'Ouranos third-party software notices\nProduction dependencies installed from package-lock.json.\n\n'+notices.join('\n\n'+'='.repeat(72)+'\n\n'))
console.log('Notices collected:',notices.length)
