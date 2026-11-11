#!/usr/bin/env node
// PreToolUse 钩子:限制子 Agent(Worker)只能改任务合同 owned 范围内的文件。
// 主会话(Architect)的调用没有 agent_id,直接放行。
// 退出码 2 = 拒绝,stderr 会回给模型作为原因。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT = path.join(ROOT, 'tasks', 'CURRENT.json');
// Worker 永远不能碰的位置,与合同无关
const ALWAYS_DENY = ['.claude/', 'tasks/', '.git/'];

function deny(msg) {
  process.stderr.write(`scope-guard 拒绝: ${msg}\n`);
  process.exit(2);
}

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

const matches = (list, rel) => list.some((g) => globToRegex(g.replace(/\\/g, '/')).test(rel));

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (e) {
  deny('无法解析钩子输入');
}

if (!input.agent_id) process.exit(0); // 主会话不受限

const ti = input.tool_input || {};
const target = ti.file_path || ti.notebook_path;
if (!target) deny(`工具 ${input.tool_name} 没有可识别的文件路径`);

const abs = path.resolve(input.cwd || ROOT, target);
const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
if (rel.startsWith('..') || path.isAbsolute(rel)) deny(`${rel} 在项目目录之外`);

const relLower = rel.toLowerCase();
if (ALWAYS_DENY.some((p) => relLower.startsWith(p))) deny(`${rel} 属于 Architect 专有区域`);

let contract;
try {
  contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
} catch (e) {
  deny('找不到有效的 tasks/CURRENT.json,没有任务合同时 Worker 不能改文件');
}

const owned = contract.owned || [];
const forbidden = contract.forbidden || [];
if (matches(forbidden, rel)) deny(`${rel} 在合同 forbidden 列表中`);
if (!matches(owned, rel)) {
  deny(`${rel} 不在任务 ${contract.id || '?'} 的 owned 范围内。若确实需要修改,请在报告中说明,由 Architect 决定`);
}
process.exit(0);
