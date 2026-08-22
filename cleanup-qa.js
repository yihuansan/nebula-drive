const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('D:/项目/cloud网盘系统/apps/server/data/nebula.db');
const r = db.prepare("DELETE FROM transfers WHERE share_url = 'https://example.com/s/qa-test'").run();
console.log('deleted qa-test rows:', r.changes);
const left = db.prepare('SELECT COUNT(*) AS c FROM transfers').get();
console.log('remaining transfers rows:', left.c);
