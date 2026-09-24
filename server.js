const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DB_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DB_DIR, 'provost-office.db');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  access TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  sender TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  date_received TEXT DEFAULT '',
  date_sent_out TEXT DEFAULT '',
  sent_to TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pending',
  priority TEXT NOT NULL DEFAULT 'Normal',
  direction TEXT NOT NULL DEFAULT 'Incoming',
  body TEXT DEFAULT '',
  unread INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT DEFAULT '',
  venue TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Scheduled',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  relative_time TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '◉',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY,
  dark INTEGER NOT NULL DEFAULT 0,
  email INTEGER NOT NULL DEFAULT 1,
  meeting INTEGER NOT NULL DEFAULT 1,
  compact INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);
try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''"); } catch {}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

const seedUsers = [
  ['provost','Provost','provost@university.edu','Provost','Superadmin'],
  ['staff1','Staff 1','staff1@university.edu','Staff','Full office access'],
  ['staff2','Staff 2','staff2@university.edu','Staff','Full office access'],
  ['itstudent','IT Student','itstudent@university.edu','IT Student','Mail input, routing and Meetings only']
];
const insertUser = db.prepare('INSERT OR IGNORE INTO users(id,name,email,password_hash,role,access) VALUES(?,?,?,?,?,?)');
for (const [id,name,email,role,access] of seedUsers) insertUser.run(id,name,email,hashPassword('password'),role,access);

const mailCount = db.prepare('SELECT COUNT(*) AS n FROM mails').get().n;
if (!mailCount) {
  const seed = db.prepare(`INSERT INTO mails(ref,subject,sender,phone,date_received,date_sent_out,sent_to,status,priority,direction,body,unread,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const rows = [
    ['PROV/2026/024','Request for Senate Committee Meeting',"Registrar's Office",'', '23 Sep 2026','', 'Provost Office','Awaiting Provost','High','Incoming','Request for approval and scheduling of the next Senate Committee meeting.',1,'provost'],
    ['PROV/2026/023','Faculty Budget Review','Bursary Department','08000000000','22 Sep 2026','23 Sep 2026','Bursary Department','Pending','Normal','Incoming','Budget review documents for the current academic session.',1,'provost'],
    ['PROV/2026/022','Staff Development Programme','Human Resources','', '21 Sep 2026','22 Sep 2026','Human Resources','Closed','Normal','Outgoing','Information regarding staff development activities.',0,'provost'],
    ['PROV/2026/021','Invitation to Academic Leadership Forum',"Vice Chancellor's Office",'', '20 Sep 2026','', 'Provost Office','Pending','High','Incoming','Official invitation to the academic leadership forum.',1,'provost'],
    ['PROV/2026/020','Departmental Accreditation Report','Quality Assurance Unit','', '19 Sep 2026','20 Sep 2026','Quality Assurance Unit','Closed','Normal','Outgoing','Accreditation report and recommendations.',0,'provost']
  ];
  for (const r of rows) seed.run(...r);
}
const meetingCount = db.prepare('SELECT COUNT(*) AS n FROM meetings').get().n;
if (!meetingCount) {
  const seed = db.prepare('INSERT INTO meetings(title,date,time,venue,created_by) VALUES(?,?,?,?,?)');
  seed.run('Management Meeting','2026-09-24','10:00','Council Chamber','provost');
  seed.run('Committee Meeting','2026-09-24','14:00','Committee Room A','provost');
  seed.run('Academic Planning Meeting','2026-09-29','11:00','Conference Room','provost');
}
const noticeCount = db.prepare('SELECT COUNT(*) AS n FROM notices').get().n;
if (!noticeCount) {
  const seed = db.prepare('INSERT INTO notices(title,message,relative_time,icon) VALUES(?,?,?,?)');
  seed.run('Mail awaiting Provost attention','PROV/2026/024 requires review.','10 minutes ago','✉');
  seed.run('Management Meeting reminder','Management Meeting starts tomorrow at 10:00 AM.','1 hour ago','▣');
  seed.run('New correspondence received','Academic Leadership Forum invitation received.','Yesterday','◉');
}
for (const id of ['provost','staff1','staff2','itstudent']) {
  db.prepare('INSERT OR IGNORE INTO settings(user_id,dark,email,meeting,compact) VALUES(?,?,?,?,?)').run(id,0,1,1,0);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(body);
}
function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').filter(Boolean).map(x => {
    const i=x.indexOf('='); return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1).trim())];
  }));
}
function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function setSession(res,userId){
  const token=crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token),userId,Date.now()+8*60*60*1000);
  res.setHeader('Set-Cookie',`po_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8*60*60}`);
}
function clearSession(req,res){
  const c=parseCookies(req); if(c.po_session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(c.po_session));
  res.setHeader('Set-Cookie','po_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
function auth(req,res){
  const c=parseCookies(req), token=c.po_session;
  if(!token) return null;
  const row=db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(tokenHash(token),Date.now());
  return row || null;
}
function requireAuth(req,res){const u=auth(req,res);if(!u)json(res,401,{error:'Authentication required'});return u;}
function isIT(u){return u && u.id==='itstudent';}
function readBody(req){return new Promise((resolve,reject)=>{let data='';req.on('data',c=>{data+=c;if(data.length>1e6)req.destroy();});req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch(e){reject(e)}});req.on('error',reject);});}
function publicUser(u){return {id:u.id,name:u.name,email:u.email,role:u.role,access:u.access};}
function getBootstrap(u){
  const mails=db.prepare('SELECT id,ref,subject,sender,phone,date_received AS dateReceived,date_sent_out AS dateSentOut,sent_to AS sentTo,status,priority,direction,body,unread FROM mails ORDER BY id DESC').all().map(x=>({...x,unread:!!x.unread}));
  const meetings=db.prepare('SELECT id,title,date,time,venue,status FROM meetings ORDER BY date,time,id').all();
  const notices=db.prepare('SELECT title,message,relative_time AS relativeTime,icon FROM notices ORDER BY id DESC').all().map(n=>[n.title,n.message,n.relativeTime,n.icon]);
  const s=db.prepare('SELECT dark,email,meeting,compact FROM settings WHERE user_id=?').get(u.id);
  return {user:publicUser(u),mails,meetings,notices,settings:{dark:!!s.dark,email:!!s.email,meeting:!!s.meeting,compact:!!s.compact}};
}

const staticMap={
  '/': 'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js'
};
function serveStatic(req,res,urlPath){
  const fileName=staticMap[urlPath] || (urlPath.startsWith('/assets/') ? urlPath.slice(1) : null);
  if(!fileName) return false;
  const file=path.resolve(ROOT,fileName);
  if(!file.startsWith(path.resolve(ROOT))) return false;
  if(!fs.existsSync(file)) return false;
  const ext=path.extname(file); const type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'}[ext]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type});fs.createReadStream(file).pipe(res);return true;
}

async function api(req,res,url){
  if(req.method==='POST' && url==='/api/login'){
    const b=await readBody(req);const u=db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1').get(String(b.email||''));
    if(!u || !verifyPassword(String(b.password||''),u.password_hash)) return json(res,401,{error:'Invalid email or password'});
    setSession(res,u.id);return json(res,200,getBootstrap(u));
  }
  if(req.method==='POST' && url==='/api/logout'){clearSession(req,res);return json(res,200,{ok:true});}
  const u=requireAuth(req,res); if(!u)return;
  if(req.method==='GET' && url==='/api/bootstrap') return json(res,200,getBootstrap(u));
  if(req.method==='GET' && url==='/api/users'){
    if(u.id!=='provost') return json(res,403,{error:'Only the Provost can manage user access'});
    return json(res,200,{users:db.prepare('SELECT id,name,email,role,access FROM users WHERE active=1 ORDER BY CASE id WHEN \'provost\' THEN 0 WHEN \'staff1\' THEN 1 WHEN \'staff2\' THEN 2 ELSE 3 END').all()});
  }
  if(req.method==='POST' && url==='/api/mails'){
    if(!['provost','staff1','staff2','itstudent'].includes(u.id)) return json(res,403,{error:'Not authorized'});
    const b=await readBody(req); if(!b.subject) return json(res,400,{error:'Subject is required'});
    try {
      const result=db.prepare(`INSERT INTO mails(ref,subject,sender,phone,date_received,date_sent_out,sent_to,status,priority,direction,body,unread,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        b.ref,b.subject,b.sender||'',b.phone||'',b.dateReceived||'',b.dateSentOut||'',b.sentTo||'',b.status||'Pending',b.priority||'Normal',b.direction||'Incoming',b.body||'',1,u.id);
      const mail=db.prepare('SELECT id,ref,subject,sender,phone,date_received AS dateReceived,date_sent_out AS dateSentOut,sent_to AS sentTo,status,priority,direction,body,unread FROM mails WHERE id=?').get(Number(result.lastInsertRowid));
      db.prepare('INSERT INTO notices(title,message,relative_time,icon) VALUES(?,?,?,?)').run('New correspondence received',`${mail.ref} — ${mail.subject}`,'Just now','✉');
      return json(res,201,{mail:{...mail,unread:!!mail.unread}});
    } catch(e){return json(res,400,{error:e.message.includes('UNIQUE')?'Reference already exists':e.message});}
  }
  if(req.method==='PUT' && url.startsWith('/api/mails/')){
    const id=Number(url.split('/').pop());const b=await readBody(req);const existing=db.prepare('SELECT * FROM mails WHERE id=?').get(id);if(!existing)return json(res,404,{error:'Mail not found'});
    if(isIT(u) && b.status!==undefined && b.status!==existing.status) return json(res,403,{error:'IT Student cannot change mail status'});
    const fields=['ref','subject','sender','phone','dateReceived','dateSentOut','sentTo','status','priority','direction','body','unread'];
    const map={ref:'ref',subject:'subject',sender:'sender',phone:'phone',dateReceived:'date_received',dateSentOut:'date_sent_out',sentTo:'sent_to',status:'status',priority:'priority',direction:'direction',body:'body',unread:'unread'};
    const sets=[];const vals=[];for(const f of fields)if(b[f]!==undefined){sets.push(`${map[f]}=?`);vals.push(f==='unread'?(b[f]?1:0):b[f]);}
    if(!sets.length)return json(res,400,{error:'No changes supplied'});sets.push('updated_at=CURRENT_TIMESTAMP');vals.push(id);db.prepare(`UPDATE mails SET ${sets.join(',')} WHERE id=?`).run(...vals);
    const mail=db.prepare('SELECT id,ref,subject,sender,phone,date_received AS dateReceived,date_sent_out AS dateSentOut,sent_to AS sentTo,status,priority,direction,body,unread FROM mails WHERE id=?').get(id);return json(res,200,{mail:{...mail,unread:!!mail.unread}});
  }
  if(req.method==='POST' && url==='/api/mails/mark-read'){
    db.prepare('UPDATE mails SET unread=0,updated_at=CURRENT_TIMESTAMP').run();return json(res,200,{ok:true});
  }
  if(req.method==='POST' && url==='/api/meetings'){
    const b=await readBody(req);if(!b.title||!b.date)return json(res,400,{error:'Title and date are required'});
    const r=db.prepare('INSERT INTO meetings(title,date,time,venue,created_by) VALUES(?,?,?,?,?)').run(b.title,b.date,b.time||'',b.venue||'',u.id);
    const meeting=db.prepare('SELECT id,title,date,time,venue,status FROM meetings WHERE id=?').get(Number(r.lastInsertRowid));
    db.prepare('INSERT INTO notices(title,message,relative_time,icon) VALUES(?,?,?,?)').run('New meeting scheduled',`${meeting.title} on ${meeting.date}`,'Just now','▣');
    return json(res,201,{meeting});
  }
  if(req.method==='POST' && url.startsWith('/api/meetings/') && url.endsWith('/cancel')){
    if(isIT(u))return json(res,403,{error:'IT Student cannot cancel meetings'});const id=Number(url.split('/')[3]);db.prepare("UPDATE meetings SET status='Cancelled' WHERE id=?").run(id);return json(res,200,{ok:true});
  }
  if(req.method==='PUT' && url==='/api/settings'){
    const b=await readBody(req);db.prepare('INSERT INTO settings(user_id,dark,email,meeting,compact) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET dark=excluded.dark,email=excluded.email,meeting=excluded.meeting,compact=excluded.compact').run(u.id,b.dark?1:0,b.email?1:0,b.meeting?1:0,b.compact?1:0);return json(res,200,{ok:true});
  }
  return json(res,404,{error:'API route not found'});
}

const server=http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname.startsWith('/api/')) return await api(req,res,url.pathname);
    if(req.method==='GET' && serveStatic(req,res,url.pathname)) return;
    json(res,404,{error:'Not found'});
  } catch(e){console.error(e);json(res,500,{error:'Server error'});}
});
server.listen(PORT,()=>console.log(`Provost Office System backend running at http://localhost:${PORT}`));
process.on('SIGINT',()=>{db.close();process.exit(0)});
