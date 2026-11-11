#!/usr/bin/env node
// 验收前的机械检查:工作区里实际改动的文件是否都在 tasks/CURRENT.json 的 owned 内。
// 用法: node .claude/hooks/check-scope.js        (检查未提交改动)
//       node .claude/hooks/check-scope.js <ref>  (检查 <ref>..HEAD 的改动)
// 通过退出 0,有越界退出 1。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks', 'CURRENT.json'), 'utf8'));

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else { re += '.*'; }
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$', 'i');
}
const matches = (list, rel) => list.some((g) => globToRegex(g).test(rel));

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const ref = process.argv[2];
let files;
if (ref) {
  files = git('diff', '--name-only', `${ref}..HEAD`).split('\n');
} else {
  const tracked = git('diff', '--name-only', 'HEAD').split('\n');
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n');
  files = tracked.concat(untracked);
}
files = [...new Set(files.map((f) => f.trim()).filter(Boolean))];
// 任务文件夹与 .claude 由 Architect 维护,不计入 Worker 越界
files = files.filter((f) => !f.startsWith('tasks/') && !f.startsWith('.claude/'));

const bad = [];
for (const f of files) {
  if (matches(contract.forbidden || [], f)) bad.push(`${f}  (forbidden)`);
  else if (!matches(contract.owned || [], f)) bad.push(`${f}  (不在 owned 内)`);
}

console.log(`任务 ${contract.id}: 改动文件 ${files.length} 个`);
files.forEach((f) => console.log('  ' + f));
if (bad.length) {
  console.log('\n越界:');
  bad.forEach((b) => console.log('  ' + b));
  process.exit(1);
}
console.log('\n范围检查通过');
