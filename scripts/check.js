const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
const files = [
  'app.js',
  'app.json',
  'package.json',
  '.prettierrc.json',
  'project.config.json',
  'database.rules.json'
].map((file) => path.join(root, file));
for (const directory of ['services', 'pages', 'cloudfunctions', 'scripts', 'tests'])
  files.push(...walk(path.join(root, directory)));
let checked = 0;
for (const file of files) {
  if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `语法检查失败：${file}`);
    checked++;
  } else if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  else if (file.endsWith('.wxml')) {
    if (/\{\{[^}]*\b\w+\s*\(/.test(fs.readFileSync(file, 'utf8')))
      throw new Error(`模板不支持调用 JS 方法：${file}`);
  }
}
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
for (const page of appConfig.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    if (!fs.existsSync(path.join(root, `${page}.${extension}`)))
      throw new Error(`页面文件缺失：${page}.${extension}`);
  }
}
for (const name of ['login', 'checkin', 'adminOps', 'updateUserInfo']) {
  for (const file of fs
    .readdirSync(path.join(root, 'cloudfunctions', '_shared'))
    .filter((file) => file.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(root, 'cloudfunctions', '_shared', file));
    const generated = fs.readFileSync(path.join(root, 'cloudfunctions', name, file));
    if (!source.equals(generated)) throw new Error(`云函数副本未同步：${name}/${file}`);
  }
}
console.log(`检查通过：${checked} 个 JS 文件、JSON、页面路由、模板表达式和云函数副本一致性`);
