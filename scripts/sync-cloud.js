const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', 'cloudfunctions');
for (const name of ['login', 'checkin', 'adminOps', 'updateUserInfo']) {
  for (const file of fs.readdirSync(path.join(root, '_shared'))) {
    if (file.endsWith('.js')) {
      fs.copyFileSync(path.join(root, '_shared', file), path.join(root, name, file));
    }
  }
}
console.log('云函数共享模块已同步到 4 个独立部署目录');
