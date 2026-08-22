const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('D:/项目/cloud网盘系统/apps/server/data/nebula.db', { readOnly: true });
const rows = db.prepare('SELECT id, user_id, share_url FROM transfers ORDER BY id').all();
console.log(JSON.stringify(rows));
